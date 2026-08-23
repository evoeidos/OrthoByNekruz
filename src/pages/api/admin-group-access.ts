import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { SUBJECTS } from '@/lib/subjects';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { getAllUserIds, registerUserId } from '@/lib/userIndex';
import { healUserFacultyFields } from '@/lib/facultyCodes';
import { normalizeStudyGroup, buildStudyGroupFromDigits } from '@/lib/studyGroup';
import type { FacultyId } from '@/lib/groupRegistry';
import {
  applyGroupAccessToUser,
  getAdminGroupAccessTree,
  loadGroupAccessRules,
  saveGroupAccessRules,
  upsertGroupAccessRule,
  type GroupAccessDurationKind,
  type GroupAccessModule,
  normalizeModules,
} from '@/lib/groupAccess';
import { buildSubjectCatalog } from '@/lib/subjectCatalog';
import { loadGroupCatalogOverlay } from '@/lib/groupCatalog';

const redis = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '978243325';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

function verifyAdmin(initData: string, secret: string): boolean {
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return false;
  if (!BOT_TOKEN) return false;
  const tgUser = verifyInitDataUser(initData, BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== ADMIN_TG_ID) return false;
  return true;
}

async function saveUser(tgId: string, data: unknown) {
  const { user: healed } = healUserFacultyFields(data as Record<string, unknown>);
  await redis.set(`user_id:${tgId}`, healed);
  await registerUserId(redis, tgId);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { initData, secret, action } = req.body ?? {};
  if (!initData || !secret || !verifyAdmin(String(initData), String(secret))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

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
      const subjectId = String(req.body.subjectId || '').trim();
      const enabled = req.body.enabled === true || req.body.enabled === 'true';

      if (!facultyId || !subjectId) {
        return res.status(400).json({ error: 'Укажи факультет и предмет.' });
      }
      if (!SUBJECTS.some(s => s.id === subjectId)) {
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

      let next = [...rules];
      for (const studyGroup of studyGroups) {
        next = upsertGroupAccessRule(next, {
          facultyId,
          studyGroup,
          subjectId,
          enabled,
          modules,
          durationKind,
          durationValue,
          examDate,
        });
      }
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
    const { user: patched, changed } = applyGroupAccessToUser(user, rules);
    if (changed) {
      await saveUser(id, patched);
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
    const { user: patched, changed } = applyGroupAccessToUser(user, rules);
    if (changed) {
      await saveUser(id, patched);
      synced++;
    }
  }
  return synced;
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
    const { user: patched, changed } = applyGroupAccessToUser(raw, rules);
    if (changed) {
      await saveUser(id, patched);
      synced++;
    }
  }
  return synced;
}
