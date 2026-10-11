import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { SUBJECTS } from '@/lib/subjects';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { updateUser } from '@/lib/userLock';
import { getAllUserIds, registerUserId } from '@/lib/userIndex';
import { healUserFacultyFields } from '@/lib/facultyCodes';
import { normalizeStudyGroup, buildStudyGroupFromDigits } from '@/lib/studyGroup';
import type { FacultyId } from '@/lib/groupRegistry';
import {
  applyGroupAccessToUser,
  buildRuleId,
  getAdminGroupAccessTree,
  loadGroupAccessRules,
  saveGroupAccessRules,
  upsertGroupAccessRule,
  upsertManyGroupAccessRules,
  allContentGroupAccessModules,
  type GroupAccessDurationKind,
  type GroupAccessModule,
  normalizeModules,
} from '@/lib/groupAccess';
import { buildSubjectCatalog } from '@/lib/subjectCatalog';
import { loadGroupCatalogOverlay } from '@/lib/groupCatalog';

const redis = createRedisFromEnv();

type GroupAccessRules = Awaited<ReturnType<typeof loadGroupAccessRules>>;

/**
 * Под блокировкой пользователя перечитать его и применить правила к свежей
 * копии — иначе запись из цикла могла затереть параллельное изменение.
 */
async function persistGroupAccess(tgId: string, rules: GroupAccessRules): Promise<boolean> {
  let changed = false;
  await updateUser<Record<string, unknown>>(redis, tgId, fresh => {
    if (!fresh || typeof fresh !== 'object') return fresh;
    const applied = applyGroupAccessToUser(fresh, rules);
    if (!applied.changed) return fresh;
    changed = true;
    return healUserFacultyFields(applied.user).user;
  });
  if (changed) await registerUserId(redis, tgId);
  return changed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body ?? {};
  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const rules = await loadGroupAccessRules(redis);

    if (action === 'tree') {
      const overlay = await loadGroupCatalogOverlay(redis);
      return res.status(200).json({
        ok: true,
        tree: getAdminGroupAccessTree(rules, overlay),
        subjects: SUBJECTS.map(s => ({
          id: s.id,
          label: s.label,
          shortLabel: s.shortLabel,
          color: s.color,
        })),
        catalog: buildSubjectCatalog().map(s => ({
          id: s.id,
          modules: s.modules.map(m => ({
            id: m.id,
            label: m.label,
            available: m.available,
          })),
        })),
      });
    }

    if (action === 'set_rule') {
      const facultyId = String(req.body.facultyId || '').trim() as FacultyId;
      const studyGroup = normalizeStudyGroup(String(req.body.studyGroup || ''));
      const subjectId = String(req.body.subjectId || '').trim();
      const enabled = req.body.enabled === true || req.body.enabled === 'true';

      if (!facultyId || !studyGroup || !subjectId) {
        return res.status(400).json({ error: 'Укажи факультет, группу и предмет.' });
      }
      if (!SUBJECTS.some(s => s.id === subjectId)) {
        return res.status(400).json({ error: 'Неизвестный предмет.' });
      }

      const durationKind = String(req.body.durationKind || 'unlimited') as GroupAccessDurationKind;
      const durationValue = req.body.durationValue != null
        ? Number(req.body.durationValue)
        : undefined;
      const examDate = req.body.examDate ? String(req.body.examDate) : undefined;
      const modules = normalizeModules(req.body.modules) as GroupAccessModule[];
      const lessonsRestricted = req.body.lessonsRestricted === true || req.body.lessonsRestricted === 'true';

      const next = upsertGroupAccessRule(rules, {
        facultyId,
        studyGroup,
        subjectId,
        enabled,
        modules,
        durationKind,
        durationValue,
        examDate,
        note: req.body.note ? String(req.body.note) : undefined,
        lessonsRestricted,
      });
      await saveGroupAccessRules(redis, next);

      let synced = 0;
      if (req.body.syncUsers === true || req.body.syncUsers === 'true') {
        synced = await syncUsersForRule(facultyId, studyGroup, next);
      }

      return res.status(200).json({
        ok: true,
        tree: getAdminGroupAccessTree(next, await loadGroupCatalogOverlay(redis)),
        synced,
      });
    }

    if (action === 'set_rules_bulk') {
      const facultyId = String(req.body.facultyId || '').trim() as FacultyId;
      const enabled = req.body.enabled === true || req.body.enabled === 'true';
      const subjectIds = resolveBulkSubjectIds(req.body);

      if (!facultyId || !subjectIds.length) {
        return res.status(400).json({ error: 'Укажи факультет и предмет.' });
      }
      if (!subjectIds.every(id => SUBJECTS.some(s => s.id === id))) {
        return res.status(400).json({ error: 'Неизвестный предмет.' });
      }

      const studyGroups = resolveBulkStudyGroups(req.body, facultyId);
      if (!studyGroups.length) {
        return res.status(400).json({ error: 'Укажи группы для изменения.' });
      }

      const durationKind = String(req.body.durationKind || 'unlimited') as GroupAccessDurationKind;
      const durationValue = req.body.durationValue != null ? Number(req.body.durationValue) : undefined;
      const examDate = req.body.examDate ? String(req.body.examDate) : undefined;
      const modules = normalizeModules(req.body.modules) as GroupAccessModule[];
      const lessonsRestricted = req.body.lessonsRestricted === true || req.body.lessonsRestricted === 'true';

      const existingIds = new Set(rules.map(r => r.id));
      const next = upsertManyGroupAccessRules(
        rules,
        studyGroups.flatMap(studyGroup => subjectIds.map(subjectId => (enabled
          ? {
            facultyId,
            studyGroup,
            subjectId,
            enabled,
            modules,
            durationKind,
            durationValue,
            examDate,
            lessonsRestricted,
          }
          // При закрытии настройки правила не трогаем — откроется с теми же.
          : { facultyId, studyGroup, subjectId, enabled })))
          // Закрывать нечего, если правила не было — не плодим пустые записи.
          .filter(p => p.enabled || existingIds.has(buildRuleId(facultyId, p.studyGroup, p.subjectId))),
      );
      await saveGroupAccessRules(redis, next);

      const synced = await syncUsersForStudyGroups(facultyId, studyGroups, next);

      return res.status(200).json({
        ok: true,
        tree: getAdminGroupAccessTree(next, await loadGroupCatalogOverlay(redis)),
        synced,
        updated: studyGroups.length,
      });
    }

    if (action === 'sync_all') {
      const synced = await syncAllUsers(rules);
      return res.status(200).json({ ok: true, synced });
    }

    if (action === 'open_all_content') {
      if (req.body.confirm !== true && req.body.confirm !== 'true') {
        return res.status(400).json({ error: 'Подтверди открытие всего контента.' });
      }

      const overlay = await loadGroupCatalogOverlay(redis);
      const tree = getAdminGroupAccessTree(rules, overlay);
      const groups = collectTreeGroups(tree);
      if (!groups.length) {
        return res.status(400).json({ error: 'В сетке нет групп.' });
      }

      const modules = allContentGroupAccessModules();
      const patches = groups.flatMap(g =>
        SUBJECTS.map(s => ({
          facultyId: g.facultyId,
          studyGroup: g.studyGroup,
          subjectId: s.id,
          enabled: true,
          modules,
          durationKind: 'unlimited' as const,
          lessonsRestricted: false,
        })),
      );

      const next = upsertManyGroupAccessRules(rules, patches);
      await saveGroupAccessRules(redis, next);
      const synced = await syncAllUsers(next);

      return res.status(200).json({
        ok: true,
        tree: getAdminGroupAccessTree(next, overlay),
        groups: groups.length,
        subjects: SUBJECTS.length,
        rules: patches.length,
        synced,
      });
    }

    if (action === 'close_all_content') {
      if (req.body.confirm !== true && req.body.confirm !== 'true') {
        return res.status(400).json({ error: 'Подтверди закрытие доступа.' });
      }
      // Без facultyId — все факультеты.
      const facultyId = String(req.body.facultyId || '').trim() as FacultyId | '';

      const now = new Date().toISOString();
      let closed = 0;
      const next = rules.map(r => {
        if (!r.enabled || (facultyId && r.facultyId !== facultyId)) return r;
        closed++;
        return { ...r, enabled: false, updatedAt: now };
      });
      await saveGroupAccessRules(redis, next);
      const synced = await syncAllUsers(next);

      return res.status(200).json({
        ok: true,
        tree: getAdminGroupAccessTree(next, await loadGroupCatalogOverlay(redis)),
        closed,
        synced,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[admin-group-access]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function syncUsersForRule(
  facultyId: FacultyId,
  studyGroup: string,
  rules: Awaited<ReturnType<typeof loadGroupAccessRules>>,
): Promise<number> {
  const ids = await getAllUserIds(redis);
  let synced = 0;
  const target = normalizeStudyGroup(studyGroup);
  for (const id of ids) {
    const raw: unknown = await redis.get(`user_id:${id}`);
    if (!raw || typeof raw !== 'object') continue;
    const user = raw as Record<string, unknown>;
    if (String(user.facultyId || '') !== facultyId) continue;
    if (normalizeStudyGroup(String(user.studyGroup || '')) !== target) continue;
    if (applyGroupAccessToUser(user, rules).changed && await persistGroupAccess(id, rules)) {
      synced++;
    }
  }
  return synced;
}

async function syncUsersForStudyGroups(
  facultyId: FacultyId,
  studyGroups: string[],
  rules: Awaited<ReturnType<typeof loadGroupAccessRules>>,
): Promise<number> {
  const targets = new Set(studyGroups.map(g => normalizeStudyGroup(g)));
  const ids = await getAllUserIds(redis);
  let synced = 0;
  for (const id of ids) {
    const raw: unknown = await redis.get(`user_id:${id}`);
    if (!raw || typeof raw !== 'object') continue;
    const user = raw as Record<string, unknown>;
    if (String(user.facultyId || '') !== facultyId) continue;
    if (!targets.has(normalizeStudyGroup(String(user.studyGroup || '')))) continue;
    if (applyGroupAccessToUser(user, rules).changed && await persistGroupAccess(id, rules)) {
      synced++;
    }
  }
  return synced;
}

/** `subjectIds: string[]` или старое `subjectId: string`. */
function resolveBulkSubjectIds(body: Record<string, unknown>): string[] {
  const raw = Array.isArray(body.subjectIds) ? body.subjectIds : [body.subjectId];
  return [...new Set(raw.map(s => String(s ?? '').trim()).filter(Boolean))];
}

function resolveBulkStudyGroups(
  body: Record<string, unknown>,
  facultyId: FacultyId,
): string[] {
  const raw = body.studyGroups;
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of raw) {
      const sg = normalizeStudyGroup(String(g));
      if (!sg || seen.has(sg)) continue;
      seen.add(sg);
      out.push(sg);
    }
    return out;
  }

  const fromDigits = Number(body.fromDigits);
  const toDigits = Number(body.toDigits);
  const course = body.course != null ? Number(body.course) : null;
  if (!Number.isFinite(fromDigits) || !Number.isFinite(toDigits)) return [];

  const out: string[] = [];
  for (let n = fromDigits; n <= toDigits; n++) {
    const digits = String(n);
    if (course != null && Number(digits[0]) !== course) continue;
    const built = buildStudyGroupFromDigits(digits, facultyId);
    if (built) out.push(built);
  }
  return out;
}

async function syncAllUsers(
  rules: Awaited<ReturnType<typeof loadGroupAccessRules>>,
): Promise<number> {
  const ids = await getAllUserIds(redis);
  let synced = 0;
  for (const id of ids) {
    const raw: unknown = await redis.get(`user_id:${id}`);
    if (!raw || typeof raw !== 'object') continue;
    if (applyGroupAccessToUser(raw, rules).changed && await persistGroupAccess(id, rules)) {
      synced++;
    }
  }
  return synced;
}

function collectTreeGroups(
  tree: ReturnType<typeof getAdminGroupAccessTree>,
): { facultyId: FacultyId; studyGroup: string }[] {
  const out: { facultyId: FacultyId; studyGroup: string }[] = [];
  const seen = new Set<string>();
  for (const fac of tree) {
    for (const course of fac.courses) {
      for (const g of course.groups) {
        const key = `${fac.facultyId}:${g.studyGroup}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ facultyId: fac.facultyId, studyGroup: g.studyGroup });
      }
    }
  }
  return out;
}
