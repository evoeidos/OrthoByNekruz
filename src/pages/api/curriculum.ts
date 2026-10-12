/**
 * /api/curriculum — занятия по плану кафедры для студента.
 *
 * Занятия — материалы с сайта университета, поэтому бесплатны: любой студент
 * с указанной группой видит планы кафедр своего факультета для своего курса.
 * Сверх этого: по открытому (купленному, выданному) предмету — вся дисциплина
 * за все курсы; по плану, выданному админом группе, — даже чужого факультета.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { getSubject } from '@/lib/subjects';
import { applyGroupAccessToUser, loadGroupAccessRules } from '@/lib/groupAccess';
import { facultyFromStudyGroup, normalizeStudyGroup } from '@/lib/studyGroup';
import { parseCourseFromGroupDigits } from '@/lib/groupRegistry';
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

  const { initData, telegramId, subjectId, programId, lessonId } = req.body ?? {};
  // Клиент показывает один предмет за раз — остальные планы (с аннотациями и тестами) не гоним по сети
  const onlySubject = typeof subjectId === 'string' && subjectId ? subjectId : null;
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

    // Определяем предметы, доступные группе через прямое назначение (любой факультет).
    const directPrograms = programsForGroup(groupMap, studyGroup, allPrograms);
    const accessibleSubjectIds = new Set(directPrograms.map(p => p.subjectId));

    // Для каждого доступного предмета показываем программы СВОЕГО факультета (все курсы).
    // Это гарантирует, что педиатры видят педиатрический контент, даже если им
    // случайно назначили стоматологическую программу по той же дисциплине.
    for (const p of allPrograms) {
      if (p.facultyId === facultyId && accessibleSubjectIds.has(p.subjectId)) {
        byId.set(p.id, p);
      }
    }

    // Fallback: если для предмета нет программы своего факультета — показываем
    // назначенную напрямую (например, когда дисциплина ведётся смешанным потоком).
    for (const p of directPrograms) {
      const ownFacultyExists = [...byId.values()].some(
        b => b.facultyId === facultyId && b.subjectId === p.subjectId,
      );
      if (!ownFacultyExists) byId.set(p.id, p);
    }

    // Программы по купленным / выданным группой предметам
    for (const p of allPrograms) {
      if (p.facultyId === facultyId && userHasSubject(user, p.subjectId)) {
        byId.set(p.id, p);
      }
    }

    // Занятия — материалы с сайта университета, поэтому бесплатно всем студентам:
    // все программы кафедр своего факультета для курса группы (208с → 2 курс).
    // Платными остаются вопросы, тесты и задачи.
    const groupCourse = parseCourseFromGroupDigits(studyGroup);
    if (groupCourse) {
      for (const p of allPrograms) {
        if (p.facultyId === facultyId && p.course === groupCourse) byId.set(p.id, p);
      }
    }

    // Предметы, по которым у студента есть занятия, — для переключателя во вкладке.
    const lessonSubjects = [...new Set([...byId.values()].map(p => p.subjectId))]
      .map(id => {
        const cfg = getSubject(id);
        return { id, label: cfg?.label ?? id, color: cfg?.color ?? 'hsl(210 90% 58%)' };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

    const visible = [...byId.values()]
      .filter(p => !onlySubject || p.subjectId === onlySubject);

    // Аннотация, вопросы и тесты занимают сотни килобайт на предмет, поэтому
    // список занятий отдаётся без них, а текст одного занятия приходит по запросу.
    if (typeof programId === 'string' && typeof lessonId === 'string') {
      const lesson = visible.find(p => p.id === programId)?.lessons.find(l => l.id === lessonId);
      if (!lesson) return res.status(404).json({ error: 'Занятие не найдено.' });
      const { annotation, images, questions, tests } = lesson;
      return res.status(200).json({ ok: true, content: { annotation, images, questions, tests } });
    }

    const programs = visible.sort((a, b) => {
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
        lessons: p.lessons.map(l => {
          const { annotation, images, questions, tests, ...rest } = l;
          const hasContent = !!(annotation?.length || images?.length || questions?.length || tests?.length);
          return hasContent ? { ...rest, hasContent } : rest;
        }),
        lectures: p.lectures,
      };
    });

    return res.status(200).json({ ok: true, studyGroup, programs, lessonSubjects });
  } catch (e) {
    if (isRedisUnavailableError(e)) {
      return res.status(503).json({ error: 'Сервис временно недоступен.' });
    }
    console.error('[curriculum]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
