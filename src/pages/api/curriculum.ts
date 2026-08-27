/**
 * /api/curriculum — занятия по плану кафедры для студента.
 *
 * Планы приходят двумя путями. Первый: у студента открыт предмет — тогда он
 * видит всю дисциплину своего факультета целиком, за все курсы, а не только
 * свой семестр. Второй: админ выдал план конкретной группе — так можно открыть
 * занятия по предмету, который студент не покупал.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { getSubject } from '@/lib/subjects';
import { applyGroupAccessToUser, loadGroupAccessRules } from '@/lib/groupAccess';
import { facultyFromStudyGroup, normalizeStudyGroup } from '@/lib/studyGroup';
import {
  type Program,
  loadAllPrograms,
  loadGroupPrograms,
  programsForGroup,
} from '@/lib/curriculum';
import { isRedisUnavailableError } from '@/lib/redisDegraded';

function userHasSubject(user: Record<string, unknown>, subjectId: string): boolean {
  const subjects = user.subjects;
  if (subjects && typeof subjects === 'object') {
    return (subjects as Record<string, unknown>)[subjectId] === true;
  }
  if (subjectId === 'ortho') return !!user.activatedKey;
  if (subjectId === 'micro') return user.micro === true;
  return false;
}

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
    let user = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!user || user.blocked === true) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const studyGroup = normalizeStudyGroup(String(user.studyGroup || ''));
    if (!studyGroup) {
      return res.status(200).json({ ok: true, studyGroup: null, programs: [] });
    }

    // Доступ по группе мог появиться после последнего входа студента
    const rules = await loadGroupAccessRules(redis);
    user = applyGroupAccessToUser(user, rules).user as Record<string, unknown>;

    const [allPrograms, groupMap] = await Promise.all([
      loadAllPrograms(redis),
      loadGroupPrograms(redis),
    ]);

    const facultyId = String(user.facultyId || '') || facultyFromStudyGroup(studyGroup);

    const byId = new Map<string, Program>();

    // Программы, явно назначенные группе
    const directPrograms = programsForGroup(groupMap, studyGroup, allPrograms);
    for (const p of directPrograms) {
      byId.set(p.id, p);
    }

    // Если группе назначена программа по предмету для факультета пользователя,
    // автоматически добавляем ВСЕ курсы того же предмета + факультета пользователя.
    // Расширяем только по своему факультету, чтобы не показывать чужие программы.
    const directSubjectIds = new Set(
      directPrograms
        .filter(p => p.facultyId === facultyId)
        .map(p => p.subjectId),
    );
    for (const p of allPrograms) {
      if (p.facultyId === facultyId && directSubjectIds.has(p.subjectId)) {
        byId.set(p.id, p);
      }
    }

    // Программы по купленным / выданным группой предметам
    for (const p of allPrograms) {
      if (p.facultyId === facultyId && userHasSubject(user, p.subjectId)) {
        byId.set(p.id, p);
      }
    }

    const programs = [...byId.values()].sort((a, b) => {
      if (a.subjectId !== b.subjectId) return a.subjectId.localeCompare(b.subjectId);
      return a.course - b.course;
    }).map(p => {
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
