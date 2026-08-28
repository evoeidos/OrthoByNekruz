import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { getFacultyStudentStats } from '@/lib/facultyStats';

const redis        = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { force } = req.body ?? {};
  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const stats = await getFacultyStudentStats(redis, { force: force === true });
    return res.status(200).json({ success: true, stats });
  } catch (e) {
    console.error('[admin-faculty-stats]', e);
    return res.status(500).json({ error: 'Не удалось посчитать статистику' });
  }
}
