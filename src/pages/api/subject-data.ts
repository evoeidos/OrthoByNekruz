// ════════════════════════════════════════════════════════════════════════════
//  /api/subject-data
//
//  Универсальный endpoint для отдачи контента ЛЮБОЙ дисциплины из SUBJECTS.
//  Не требует правок при добавлении новых предметов — берёт имя файла из
//  конфига и грузит соответствующий JSON.
//
//  Тело запроса (JSON):
//    {
//      subject:    'micro' | 'bio' | 'fizo' | ...   (id из SUBJECTS)
//      type:       'questions' | 'tests' | 'tasks' | 'glossary' | 'tickets'
//      telegramId: <id пользователя>
//      initData:   <window.Telegram.WebApp.initData>
//    }
//
//  Защита:
//    1. Криптографическая проверка initData (HMAC-SHA256 по BOT_TOKEN)
//    2. Сверка tgUser.id с telegramId из тела
//    3. Проверка user.subjects[subjectId] === true в Redis
//    4. Whitelist имён файлов через getAllDataFileNames() — защита от
//       path traversal даже теоретически
// ════════════════════════════════════════════════════════════════════════════

import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { applyGroupAccessToUser, loadGroupAccessRules } from '@/lib/groupAccess';
import { getSubject } from '@/lib/subjects';
import { loadDataFile } from '@/lib/dataFiles';
import { resolveBioQuestionsFile } from '@/lib/bioQuestions';
import { filterBioTasksForFaculty, resolveBioFacultyId, resolveBioTasksFile } from '@/lib/bioTasks';
import { filterChemTasksForFaculty, resolveChemFacultyId, resolveChemTasksFile } from '@/lib/chemTasks';
import { resolveBioximTestsFile } from '@/lib/bioximTests';
import { computePreviewExpiry, isPreviewExpired } from '@/lib/preview';
import { type ModuleDataType, moduleAccessError, userHasSubject } from '@/lib/subjectAccess';
import { isRedisUnavailableError } from '@/lib/redisDegraded';
import { buildExamTicketsForSubject, hasExamTicketData } from '@/lib/examTickets';
import { isUserLockTimeout, withUserLock } from '@/lib/userLock';
import { alertAdmin } from '@/lib/alertAdmin';

const redis     = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

type SubjectCfg = NonNullable<ReturnType<typeof getSubject>>;

/** Данные раздела: файл по факультету и, для задач, фильтр по факультету. */
async function loadModuleData(
  subjectCfg: SubjectCfg,
  user: any,
  dataType: ModuleDataType,
): Promise<{ data: unknown } | { status: number; error: string; hint?: string }> {
  let fileName: string | null = null;
  switch (dataType) {
    case 'questions':
      fileName = subjectCfg.id === 'bio'
        ? resolveBioQuestionsFile(user?.facultyId)
        : subjectCfg.questionsFile;
      break;
    case 'tasks':
      if (subjectCfg.id === 'bio') {
        fileName = resolveBioTasksFile(resolveBioFacultyId(user));
        if (!fileName) {
          return { status: 403, error: 'Задачи по биологии недоступны для этого факультета' };
        }
      } else if (subjectCfg.id === 'chem') {
        fileName = resolveChemTasksFile(resolveChemFacultyId(user));
        if (!fileName) {
          return { status: 403, error: 'Задачи по химии доступны педиатрам и лечебникам' };
        }
      } else {
        fileName = subjectCfg.tasksFile;
      }
      break;
    case 'tests':
      // У педиатров по биохимии свой банк тестов
      fileName = subjectCfg.id === 'bioxim'
        ? resolveBioximTestsFile(resolveBioFacultyId(user))
        : subjectCfg.testsFile;
      break;
    case 'glossary':  fileName = subjectCfg.glossaryFile;  break;
  }

  const data = await loadDataFile(fileName);
  if (data === null) {
    return {
      status: 404,
      error: `Data file not found: ${fileName}`,
      hint:  'Положите JSON в src/data/ и пересоберите приложение.',
    };
  }

  if (dataType === 'tasks' && Array.isArray(data)) {
    if (subjectCfg.id === 'bio') {
      const filtered = filterBioTasksForFaculty(data as { faculties?: string[] }[], resolveBioFacultyId(user));
      return { data: filtered.map(({ faculties: _f, ...rest }) => rest) };
    }
    if (subjectCfg.id === 'chem') {
      const filtered = filterChemTasksForFaculty(data as { faculties?: string[] }[], resolveChemFacultyId(user));
      return { data: filtered.map(({ faculties: _f, ...rest }) => rest) };
    }
  }
  return { data };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { subject, type, telegramId, initData } = req.body ?? {};

    if (!BOT_TOKEN || !telegramId || !subject || !type) {
      return res.status(400).json({ error: 'Bad request' });
    }

    const subjectCfg = getSubject(String(subject));
    if (!subjectCfg) {
      return res.status(400).json({ error: 'Unknown subject' });
    }

    // 1. Верификация: initData или веб-сессия
    const { resolveRequestIdentity } = await import('@/lib/resolveIdentity');
    const identity = await resolveRequestIdentity(redis, req, {
      telegramId,
      initData,
      requireTelegram: true,
    });
    if (!identity.ok || identity.tgId !== String(telegramId)) {
      return res.status(identity.ok ? 401 : identity.status).json({
        error: identity.ok ? 'Unauthorized' : identity.error,
        code: identity.ok ? undefined : identity.code,
      });
    }

    // 2. Проверка доступа к дисциплине
    let user: any;
    try {
      // Почти всегда это только чтение — без блокировки. Если истекла проба
      // или поменялся групповой доступ, запись идёт под блокировкой
      // пользователя по свежей копии (иначе затёрли бы параллельную запись
      // админа). Раньше блокировку брал каждый запрос контента, и при
      // нескольких запросах разом они упирались в таймаут ожидания.
      const tgId = String(telegramId);
      const rules = await loadGroupAccessRules(redis);
      const project = (u: any) => applyGroupAccessToUser(computePreviewExpiry(u, tgId), rules).user;
      const current: any = await redis.get(`user_id:${tgId}`);
      user = project(current);
      if (user !== current) {
        user = await withUserLock(redis, tgId, async () => {
          const fresh: any = await redis.get(`user_id:${tgId}`);
          const next = project(fresh);
          if (next !== fresh) await redis.set(`user_id:${tgId}`, next);
          return next;
        }, 'subject-data');
      }
    } catch (err) {
      if (isRedisUnavailableError(err) || isUserLockTimeout(err)) {
        alertAdmin('subject-data:503', 'контент: Redis недоступен или блокировка не взята', err);
        return res.status(503).json({ error: 'Service temporarily unavailable', degraded: true });
      }
      throw err;
    }
    if (user?.blocked === true) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    if (user?.previewStatus === 'active' && isPreviewExpired(user, Date.now(), String(telegramId))) {
      return res.status(403).json({ error: 'Preview expired' });
    }
    if (!userHasSubject(user, subjectCfg.id)) {
      return res.status(403).json({ error: 'No access to subject' });
    }

    // Билеты содержат ответы на вопросы и задачи — нужен доступ к обоим разделам.
    if (type === 'tickets') {
      for (const mod of ['questions', 'tasks'] as const) {
        const denied = moduleAccessError(user, subjectCfg.id, mod, String(telegramId));
        if (denied) return res.status(403).json({ error: denied });
      }
      const [questions, tasks] = await Promise.all([
        loadModuleData(subjectCfg, user, 'questions'),
        loadModuleData(subjectCfg, user, 'tasks'),
      ]);
      const qList = 'data' in questions && Array.isArray(questions.data) ? questions.data : [];
      const tList = 'data' in tasks && Array.isArray(tasks.data) ? tasks.data : [];
      const tickets = hasExamTicketData(subjectCfg.id, qList, tList)
        ? buildExamTicketsForSubject(subjectCfg.id, qList, tList)
        : [];
      return res.status(200).json({ data: tickets });
    }

    const dataType = String(type) as ModuleDataType;
    if (!['questions', 'tests', 'tasks', 'glossary'].includes(dataType)) {
      return res.status(400).json({ error: 'Unknown type' });
    }
    const denied = moduleAccessError(user, subjectCfg.id, dataType, String(telegramId));
    if (denied) return res.status(403).json({ error: denied });

    // 3. Выбор файла по type
    const loaded = await loadModuleData(subjectCfg, user, dataType);
    if ('status' in loaded) {
      return res.status(loaded.status).json({ error: loaded.error, hint: loaded.hint });
    }
    let data = loaded.data;

    // Мёрж кастомных записей глоссария из Redis
    if (type === 'glossary' && Array.isArray(data)) {
      try {
        const customRaw = await redis.get(`glossary_custom:${subjectCfg.id}`);
        const custom: any[] = Array.isArray(customRaw) ? customRaw : [];
        if (custom.length > 0) {
          // Кастомные записи имеют приоритет: убираем из JSON те термины, что есть в Redis
          const customTermsLower = new Set(custom.map((e: any) => String(e.term).toLowerCase()));
          const base = (data as any[]).filter(e => !customTermsLower.has(String(e.term).toLowerCase()));
          return res.status(200).json({ data: [...custom, ...base] });
        }
      } catch { /* Redis недоступен — отдаём только JSON */ }
    }

    // Мёрж Redis-оверрайдов relatedTerms для questions/tests/tasks
    if (type !== 'glossary' && Array.isArray(data)) {
      try {
        const overridesRaw = await redis.get(`relatedTerms:${subjectCfg.id}:${type}`);
        if (overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)) {
          const overrides = overridesRaw as Record<string, string[]>;
          const merged = (data as any[]).map(item => {
            const id = String(item.id);
            if (id in overrides) {
              const base = [
                ...((item.related_glossary as string[] | undefined) ?? []),
                ...((item.relatedTerms as string[] | undefined) ?? []),
              ];
              const terms = [...new Set([...overrides[id], ...base].map(t => String(t).trim()).filter(Boolean))];
              return { ...item, relatedTerms: terms, related_glossary: terms };
            }
            return item;
          });
          data = merged;
        }
      } catch { /* Redis недоступен — отдаём JSON без оверрайдов */ }
    }

    return res.status(200).json({ data });

  } catch (err) {
    console.error('[subject-data] error:', err);
    alertAdmin('subject-data:500', 'контент: ошибка сервера', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
