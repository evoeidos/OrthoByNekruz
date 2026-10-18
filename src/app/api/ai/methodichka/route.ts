import { NextResponse } from 'next/server';
import { friendlyAiError, generateQuestionAiAnswer } from '@/lib/questionAi';
import {
  buildMethodichkaPrompts,
  loadStoredMethodichkaAi,
  methodichkaAiLockKey,
  methodichkaTextHash,
  saveMethodichkaAi,
} from '@/lib/methodichkaAi';
import { verifyApiStudyUser } from '@/lib/apiUserAuth';
import { createRedisFromEnv } from '@/lib/redis';
import { checkAiRateLimit } from '@/lib/aiRateLimit';
import { alertAdmin } from '@/lib/alertAdmin';
import { fetchUniversityMethodichka } from '@/lib/universityParser';
import { getFacultyPromoById } from '@/lib/facultyCodes';
import { facultyFromStudyGroup } from '@/lib/studyGroup';

const redis = createRedisFromEnv();

// Конспект — длинный разбор по пяти разделам из методички до 30 000 символов.
// DeepSeek сначала рассуждает: 2000 токенов вопросов уходили на рассуждения
// целиком, а 8000 не хватало длинным методичкам (разбор до ~19 КБ) — ответ
// обрезался и не сохранялся, студент при повторном нажатии ждал заново.
const METHODICHKA_AI_LIMITS = {
  timewebMaxTokens: 16_000,
  timewebTimeoutMs: 150_000,
  totalBudgetMs: 170_000,
};

// Блокировка генерации живёт чуть дольше бюджета ИИ; ждущие проверяют,
// не появился ли конспект, раз в пару секунд.
const GENERATE_LOCK_SEC = 200;
const WAIT_FOR_OTHER_MS = 180_000;
const WAIT_POLL_MS = 2_000;

/** Факультет студента из профиля, а не от клиента; по группе, если не выбран. */
function resolveStudentFaculty(user: Record<string, unknown>): { id: string; label?: string } {
  const id = String(user.facultyId || '').trim()
    || facultyFromStudyGroup(String(user.studyGroup || ''))
    || '';
  const promo = id ? getFacultyPromoById(id) : null;
  return promo ? { id: promo.id, label: promo.facultyLabel } : { id: 'general' };
}

/** Конспект, который сейчас делает другой запрос, — или null, если не дождались. */
async function waitForOtherGeneration(tlId: string, facultyId: string, hash: string): Promise<string | null> {
  const deadline = Date.now() + WAIT_FOR_OTHER_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, WAIT_POLL_MS));
    const stored = await loadStoredMethodichkaAi(redis, tlId, facultyId);
    if (stored?.hash === hash) return stored.result;
    // Тот запрос закончился без результата — генерировать самим.
    if (!(await redis.exists(methodichkaAiLockKey(tlId, facultyId)))) return null;
  }
  return null;
}

export async function POST(req: Request) {
  let body: { tlId?: string; initData?: string; telegramId?: string; discipline?: string; topic?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });
  }

  const auth = await verifyApiStudyUser(body.initData, body.telegramId, {
    cookieHeader: req.headers.get('cookie'),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const tlId = String(body.tlId || '').trim();
  if (!/^\d+$/.test(tlId)) {
    return NextResponse.json({ error: 'Нет данных методички' }, { status: 400 });
  }

  try {
    // Готовый конспект своего факультета не тратит ни токены, ни лимит запросов.
    const faculty = resolveStudentFaculty(auth.user);
    const stored = await loadStoredMethodichkaAi(redis, tlId, faculty.id);

    let methodichka;
    try {
      ({ methodichka } = await fetchUniversityMethodichka(redis, auth.tgId, tlId));
    } catch (e) {
      // Сайт вуза недоступен — отдаём сохранённый конспект, если он есть.
      if (stored) return NextResponse.json({ result: stored.result });
      throw e;
    }
    if (!methodichka) {
      if (stored) return NextResponse.json({ result: stored.result });
      return NextResponse.json({ error: 'Методичка не найдена' }, { status: 404 });
    }

    const hash = methodichkaTextHash(methodichka);
    if (stored?.hash === hash) {
      return NextResponse.json({ result: stored.result });
    }

    // Первым конспект делает тот, кто взял блокировку; остальные ждут его.
    const lockKey = methodichkaAiLockKey(tlId, faculty.id);
    const locked = await redis.set(lockKey, auth.tgId, { ex: GENERATE_LOCK_SEC, nx: true });
    if (locked === null) {
      const ready = await waitForOtherGeneration(tlId, faculty.id, hash);
      if (ready) return NextResponse.json({ result: ready });
      return NextResponse.json(
        { error: 'Конспект ещё готовится — попробуй через минуту.' },
        { status: 503 },
      );
    }

    try {
      const limit = await checkAiRateLimit(redis, auth.tgId);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: limit.error },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
        );
      }

      const context = { discipline: body.discipline, topic: body.topic, faculty: faculty.label };
      const { systemInstruction, userPrompt } = buildMethodichkaPrompts(methodichka, context);
      const out = await generateQuestionAiAnswer(systemInstruction, userPrompt, METHODICHKA_AI_LIMITS);
      if (out.result) {
        // Обрезанный конспект тоже сохраняем — иначе каждое нажатие
        // генерировало бы его заново, — но на неделю и с алертом о лимите.
        await saveMethodichkaAi(redis, tlId, faculty.id, hash, out.result, !!out.truncated);
        if (out.truncated) {
          alertAdmin(
            'ai:methodichka:truncated',
            'ИИ: конспект методички обрезан лимитом токенов',
            `методичка ${tlId}, ${faculty.id}\n${out.detail ?? ''}`,
          );
        }
        return NextResponse.json({ result: out.result });
      }
      alertAdmin('ai:methodichka', 'ИИ: не удалось сделать конспект методички', out.detail ?? out.error);
      return NextResponse.json(
        { error: friendlyAiError(out.error || 'Не удалось получить ответ') },
        { status: 503 },
      );
    } finally {
      // Снимаем только свою блокировку (не истёкшую и не перехваченную).
      // String(): Redis-обёртка отдаёт строку из цифр (Telegram ID) числом.
      if (String(await redis.get(lockKey).catch(() => null)) === String(auth.tgId)) {
        await redis.del(lockKey).catch(() => 0);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Сервер недоступен';
    return NextResponse.json({ error: friendlyAiError(msg) }, { status: 500 });
  }
}
