import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { getSubject } from '@/lib/subjects';
import { isRedisUnavailableError } from '@/lib/redisDegraded';

const redis     = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const WEAK_THRESHOLD = 60;

function sessionKey(tgId: string, date: string) {
  return `truefalse:${tgId}:${date}`;
}

function weakTopicsKey(tgId: string, subjectId: string) {
  return `truefalse_weak:${subjectId}:${tgId}`;
}

async function authRequest(req: NextApiRequest): Promise<{ tgId: string } | { error: string; status: number; code?: string }> {
  const { telegramId, initData, subject } = req.body ?? {};
  if (!telegramId || !subject) {
    return { error: 'Bad request', status: 400 };
  }

  const subjectCfg = getSubject(String(subject));
  if (!subjectCfg) {
    return { error: 'Unknown subject', status: 400 };
  }

  const { resolveRequestIdentity } = await import('@/lib/resolveIdentity');
  const identity = await resolveRequestIdentity(redis, req, {
    telegramId,
    initData,
    requireTelegram: true,
  });
  if (!identity.ok || identity.tgId !== String(telegramId)) {
    return {
      error: identity.ok ? 'Unauthorized' : identity.error,
      status: identity.ok ? 401 : identity.status,
      code: identity.ok ? undefined : identity.code,
    };
  }

  return { tgId: String(telegramId) };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const auth = await authRequest(req);
    if ('error' in auth) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const { tgId } = auth;
    const { mode, subject, date, percent, topicResults } = req.body ?? {};
    const subjectId = String(subject || 'bio');

    if (mode === 'save_session') {
      const day = String(date || new Date().toISOString().slice(0, 10));
      const pct = Number(percent);
      if (!Number.isFinite(pct)) {
        return res.status(400).json({ error: 'Invalid percent' });
      }

      await redis.set(sessionKey(tgId, day), {
        percent: pct,
        subject: subjectId,
        savedAt: new Date().toISOString(),
      });

      const weakKey = weakTopicsKey(tgId, subjectId);
      const topics = Array.isArray(topicResults) ? topicResults : [];
      for (const row of topics) {
        const topicId = String(row?.topicId ?? '');
        const total = Number(row?.total ?? 0);
        const correct = Number(row?.correct ?? 0);
        if (!topicId || total <= 0) continue;
        const topicPct = Math.round((correct / total) * 100);
        if (topicPct < WEAK_THRESHOLD) {
          await redis.sadd(weakKey, topicId);
        } else {
          await redis.srem(weakKey, topicId);
        }
      }

      return res.status(200).json({ success: true });
    }

    if (mode === 'list_weak') {
      const members = await redis.smembers(weakTopicsKey(tgId, subjectId));
      const list = Array.isArray(members) ? members.map(String) : [];
      return res.status(200).json({ success: true, weakTopics: list });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (err) {
    console.error('[true-false] error:', err);
    if (isRedisUnavailableError(err)) {
      return res.status(503).json({ error: 'Service temporarily unavailable', degraded: true });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}
