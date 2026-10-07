import { NextResponse } from 'next/server';
import { friendlyAiError, generateQuestionAiAnswer } from '@/lib/questionAi';
import { buildMethodichkaPrompts } from '@/lib/methodichkaAi';
import { verifyApiStudyUser } from '@/lib/apiUserAuth';
import { createRedisFromEnv } from '@/lib/redis';
import { checkAiRateLimit } from '@/lib/aiRateLimit';
import { fetchUniversityMethodichka } from '@/lib/universityParser';

const redis = createRedisFromEnv();

export async function POST(req: Request) {
  let body: { tlId?: string; initData?: string; telegramId?: string };
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

  const limit = await checkAiRateLimit(redis, auth.tgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.error },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const tlId = String(body.tlId || '').trim();
  if (!/^\d+$/.test(tlId)) {
    return NextResponse.json({ error: 'Нет данных методички' }, { status: 400 });
  }

  try {
    const { methodichka } = await fetchUniversityMethodichka(redis, auth.tgId, tlId);
    if (!methodichka) {
      return NextResponse.json({ error: 'Методичка не найдена' }, { status: 404 });
    }

    const { systemInstruction, userPrompt } = buildMethodichkaPrompts(methodichka);
    const out = await generateQuestionAiAnswer(systemInstruction, userPrompt);
    if (out.result) {
      return NextResponse.json({ result: out.result });
    }
    return NextResponse.json(
      { error: friendlyAiError(out.error || 'Не удалось получить ответ') },
      { status: 503 },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Сервер недоступен';
    return NextResponse.json({ error: friendlyAiError(msg) }, { status: 500 });
  }
}
