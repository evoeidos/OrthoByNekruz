import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataId } from '@/lib/verifyInitData';
import { getSubject } from '@/lib/subjects';
import { isRedisUnavailableError } from '@/lib/redisDegraded';
import { flashcardMember, parseFlashcardMember } from '@/lib/flashcards';

const redis     = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

function weakSetKey(tgId: string, subjectId: string) {
  return `flashcard_weak:${subjectId}:${tgId}`;
}

function weakItemKey(tgId: string, questionId: number, factIndex: number) {
  return `flashcard:${tgId}:${questionId}:${factIndex}`;
}

async function authRequest(req: NextApiRequest): Promise<{ tgId: string } | { error: string; status: number }> {
  const { telegramId, initData, subject } = req.body ?? {};
  if (!BOT_TOKEN || !telegramId || !subject) {
    return { error: 'Bad request', status: 400 };
  }

  const subjectCfg = getSubject(String(subject));
  if (!subjectCfg) {
    return { error: 'Unknown subject', status: 400 };
  }

  if (!initData) {
    const inWL = await redis.sismember('sub_whitelist', String(telegramId));
    if (!inWL) return { error: 'Unauthorized', status: 401 };
  } else {
    const userId = verifyInitDataId(String(initData), BOT_TOKEN);
    if (!userId || String(userId) !== String(telegramId)) {
      return { error: 'Unauthorized', status: 401 };
    }
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
    const { mode, subject, questionId, factIndex } = req.body ?? {};
    const subjectId = String(subject || 'bio');
    const setKey = weakSetKey(tgId, subjectId);

    if (mode === 'list') {
      const members = await redis.smembers(setKey);
      const list = Array.isArray(members) ? members.map(String) : [];
      return res.status(200).json({ success: true, weak: list });
    }

    if (mode === 'mark_weak') {
      const qId = Number(questionId);
      const fIdx = Number(factIndex);
      if (!Number.isFinite(qId) || !Number.isFinite(fIdx) || fIdx < 0) {
        return res.status(400).json({ error: 'Invalid card id' });
      }
      const member = flashcardMember(qId, fIdx);
      await redis.sadd(setKey, member);
      await redis.set(weakItemKey(tgId, qId, fIdx), new Date().toISOString());
      return res.status(200).json({ success: true });
    }

    if (mode === 'mark_known') {
      const qId = Number(questionId);
      const fIdx = Number(factIndex);
      if (!Number.isFinite(qId) || !Number.isFinite(fIdx) || fIdx < 0) {
        return res.status(400).json({ error: 'Invalid card id' });
      }
      const member = flashcardMember(qId, fIdx);
      await redis.srem(setKey, member);
      await redis.del(weakItemKey(tgId, qId, fIdx));
      return res.status(200).json({ success: true });
    }

    if (mode === 'clear_weak') {
      const members = await redis.smembers(setKey);
      const list = Array.isArray(members) ? members.map(String) : [];
      for (const m of list) {
        const parsed = parseFlashcardMember(m);
        if (parsed) await redis.del(weakItemKey(tgId, parsed.questionId, parsed.factIndex));
      }
      await redis.del(setKey);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (err) {
    console.error('[flashcards] error:', err);
    if (isRedisUnavailableError(err)) {
      return res.status(503).json({ error: 'Service temporarily unavailable', degraded: true });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}
