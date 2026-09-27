import { NextResponse } from 'next/server';
import { isKrasgmuAuthError } from '@/lib/krasgmu/errors';
import { fetchKrasgmuPhoto } from '@/lib/krasgmu/service';
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

  try {
    const { buffer, contentType } = await fetchKrasgmuPhoto(redis, identity.tgId);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    if (isKrasgmuAuthError(e)) {
      const status = e.code === 'invalid_credentials' ? 401 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error('[university/photo]', e);
    return NextResponse.json({ error: 'Не удалось загрузить фото' }, { status: 500 });
  }
}
