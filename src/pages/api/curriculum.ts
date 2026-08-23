/**
 * /api/curriculum — занятия по плану кафедры для группы студента.
 *
 * Что видит студент, решает админ: программа появляется у группы только после
 * того, как её выдали во вкладке «Занятия». Поэтому отдельной проверки оплаты
 * здесь нет — назначение программы группе и есть разрешение.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { getSubject } from '@/lib/subjects';
import { normalizeStudyGroup } from '@/lib/studyGroup';
import { loadAllPrograms, loadGroupPrograms, programsForGroup } from '@/lib/curriculum';
import { isRedisUnavailableError } from '@/lib/redisDegraded';

const redis = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { initData, telegramId } = req.body ?? {};
  if (!initData || !telegramId) {
    return res.status(400).json({ error: 'Нет данных запроса.' });
  }
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'Сервер не настроен.' });
  }

  const tgUser = verifyInitDataUser(String(initData), BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== String(telegramId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const raw: unknown = await redis.get(`user_id:${telegramId}`);
    const user = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!user || user.blocked === true) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const studyGroup = normalizeStudyGroup(String(user.studyGroup || ''));
    if (!studyGroup) {
      return res.status(200).json({ ok: true, studyGroup: null, programs: [] });
    }

    const [allPrograms, groupMap] = await Promise.all([
      loadAllPrograms(redis),
      loadGroupPrograms(redis),
    ]);

    const programs = programsForGroup(groupMap, studyGroup, allPrograms).map(p => {
      const subject = getSubject(p.subjectId);
      return {
        id: p.id,
        subjectId: p.subjectId,
        subjectLabel: subject?.label ?? p.subjectId,
        subjectColor: subject?.color ?? 'hsl(210 90% 58%)',
        title: p.title,
        sourceDoc: p.sourceDoc ?? null,
        course: p.course,
        lessons: p.lessons,
        lectures: p.lectures,
      };
    });

    return res.status(200).json({ ok: true, studyGroup, programs });
  } catch (e) {
    if (isRedisUnavailableError(e)) {
      return res.status(503).json({ error: 'Сервис временно недоступен.' });
    }
    console.error('[curriculum]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
