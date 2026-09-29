import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';
import { KrasgmuAuthError } from '@/lib/krasgmu/client';
import {
  fetchKrasgmuGrades,
  fetchKrasgmuLectureTopics,
  fetchKrasgmuProfile,
  fetchKrasgmuSchedule,
} from '@/lib/krasgmu/service';
import { deleteBinding, getBindStatus } from '@/lib/krasgmu/store';

const redis = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegramId, initData, action } = req.body ?? {};

  const identity = await resolveRequestIdentity(redis, req, {
    telegramId,
    initData,
    requireTelegram: true,
  });
  if (!identity.ok) {
    return res.status(identity.status).json({ error: identity.error, code: identity.code });
  }

  const act = String(action || 'status');

  if (act === 'unbind') {
    await deleteBinding(redis, identity.tgId);
    return res.status(200).json({ success: true, bound: false });
  }

  if (act === 'status') {
    const status = await getBindStatus(redis, identity.tgId);
    return res.status(200).json({ success: true, ...status });
  }

  try {
    if (act === 'schedule') {
      const data = await fetchKrasgmuSchedule(redis, identity.tgId);
      return res.status(200).json({ success: true, ...data });
    }
    if (act === 'grades') {
      const data = await fetchKrasgmuGrades(redis, identity.tgId);
      return res.status(200).json({ success: true, ...data });
    }
    if (act === 'profile') {
      const data = await fetchKrasgmuProfile(redis, identity.tgId);
      return res.status(200).json({ success: true, ...data });
    }
    if (act === 'topics') {
      const data = await fetchKrasgmuLectureTopics(redis, identity.tgId);
      return res.status(200).json({ success: true, ...data });
    }
    if (act === 'all') {
      const [scheduleData, gradesData, profileData] = await Promise.all([
        fetchKrasgmuSchedule(redis, identity.tgId),
        fetchKrasgmuGrades(redis, identity.tgId),
        fetchKrasgmuProfile(redis, identity.tgId),
      ]);
      return res.status(200).json({
        success: true,
        login: scheduleData.login,
        schedule: scheduleData.schedule,
        grades: gradesData.grades,
        profile: profileData.profile,
      });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e instanceof KrasgmuAuthError) {
      const status = e.code === 'invalid_credentials' ? 401 : 502;
      return res.status(status).json({ error: e.message, code: e.code });
    }
    console.error('[krasgmu-data]', e);
    return res.status(500).json({ error: 'Не удалось загрузить данные КрасГМУ' });
  }
}
