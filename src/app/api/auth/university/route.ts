import { NextResponse } from 'next/server';
import { bindUniversityAccount } from '@/lib/krasgmu/bindAccount';
import { createRedisFromEnv } from '@/lib/redis';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';

const redis = createRedisFromEnv();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const login = String(body.login ?? '').trim();
  const password = String(body.password ?? '');
  const telegramId = String(body.telegram_id ?? body.telegramId ?? '').trim();
  const initData = String(body.initData ?? '');

  const identity = await resolveRequestIdentity(redis, null, {
    telegramId,
    initData,
    requireTelegram: true,
    cookieHeader: req.headers.get('cookie'),
  });
  if (!identity.ok) {
    return NextResponse.json(
      { error: identity.error, code: identity.code },
      { status: identity.status },
    );
  }

  const result = await bindUniversityAccount(redis, identity.tgId, login, password);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, detail: result.detail },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    message: result.message,
    login: result.login,
  });
}
