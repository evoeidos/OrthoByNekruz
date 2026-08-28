import { NextResponse } from 'next/server';
import { buildQuestionAiPrompts, friendlyAiError, generateQuestionAiAnswer } from '@/lib/questionAi';
import { verifyApiStudyUser } from '@/lib/apiUserAuth';
import { createRedisFromEnv } from '@/lib/redis';
import { checkAiRateLimit } from '@/lib/aiRateLimit';

const redis = createRedisFromEnv();

export async function POST(req: Request) {
  let body: {
    mode?: string;
    question?: string;
    answer?: string;
    userQuestion?: string;
    initData?: string;
    telegramId?: string;
  };
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

  // Право на доступ ≠ безлимит: без этого один аккаунт может раскрутить
  // счёт за Timeweb/Groq/Gemini, крутя эндпоинт в цикле.
  const limit = await checkAiRateLimit(redis, auth.tgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.error },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const { mode, question, answer, userQuestion } = body;

  if (!question || !answer) {
    return NextResponse.json({ error: 'Нет данных вопроса' }, { status: 400 });
  }

  if (mode === 'ask' && !String(userQuestion || '').trim()) {
    return NextResponse.json({ error: 'Введи вопрос' }, { status: 400 });
  }

  const { systemInstruction, userPrompt } = buildQuestionAiPrompts(
    mode || 'explain',
    question,
    answer,
    userQuestion,
  );

  try {
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
