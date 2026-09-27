import { NextResponse } from 'next/server';
import { deleteBinding, getBindStatus } from '@/lib/krasgmu/store';
import {
  fetchUniversityGrades,
  fetchUniversityProfile,
  fetchUniversitySchedule,
} from '@/lib/universityParser';
import { isKrasgmuAuthError } from '@/lib/krasgmu/errors';
import { createRedisFromEnv } from '@/lib/redis';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';

const redis = createRedisFromEnv();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveTg(req: Request, body: Record<string, unknown>) {
  const telegramId = String(body.telegram_id ?? body.telegramId ?? '').trim();
  const initData = String(body.initData ?? '');
  return resolveRequestIdentity(redis, null, {
    telegramId,
    initData,
    requireTelegram: true,
    cookieHeader: req.headers.get('cookie'),
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const identity = await resolveTg(req, body);
  if (!identity.ok) {
    return NextResponse.json(
      { error: identity.error, code: identity.code },
      { status: identity.status },
    );
  }

  const act = String(body.action || 'status');

  if (act === 'unbind') {
    await deleteBinding(redis, identity.tgId);
    return NextResponse.json({ success: true, bound: false });
  }

  if (act === 'status') {
    const status = await getBindStatus(redis, identity.tgId);
    return NextResponse.json({ success: true, ...status });
  }

  try {
    if (act === 'schedule') {
      const data = await fetchUniversitySchedule(redis, identity.tgId);
      return NextResponse.json({ success: true, ...data });
    }
    if (act === 'grades') {
      const data = await fetchUniversityGrades(redis, identity.tgId);
      return NextResponse.json({ success: true, ...data });
    }
    if (act === 'profile') {
      const data = await fetchUniversityProfile(redis, identity.tgId);
      return NextResponse.json({ success: true, ...data });
    }
    if (act === 'all') {
      const [scheduleData, gradesData, profileData] = await Promise.all([
        fetchUniversitySchedule(redis, identity.tgId),
        fetchUniversityGrades(redis, identity.tgId),
        fetchUniversityProfile(redis, identity.tgId),
      ]);
      return NextResponse.json({
        success: true,
        login: scheduleData.login,
        schedule: scheduleData.schedule,
        grades: gradesData.grades,
        profile: profileData.profile,
      });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    if (isKrasgmuAuthError(e)) {
      const status = e.code === 'invalid_credentials' ? 401 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error('[university/data]', e);
    return NextResponse.json({ error: 'Не удалось загрузить данные КрасГМУ' }, { status: 500 });
  }
}
