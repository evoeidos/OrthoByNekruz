/**
 * Админка «Занятия»: состав групп, программы кафедр и списки деканата.
 * Доступ к предметам и оплата остаются в admin-group-access.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { SUBJECTS, getSubject } from '@/lib/subjects';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { getAllUserIds } from '@/lib/userIndex';
import { normalizeStudyGroup } from '@/lib/studyGroup';
import type { FacultyId } from '@/lib/groupRegistry';
import {
  addCustomGroup,
  buildGroupCatalogTree,
  listHiddenGroups,
  loadGroupCatalogOverlay,
  removeGroupFromCatalog,
  restoreHiddenGroup,
  saveGroupCatalogOverlay,
} from '@/lib/groupCatalog';
import {
  type Lecture,
  type Lesson,
  type Program,
  buildProgramId,
  countGroupsPerProgram,
  defaultProgramTitle,
  deleteProgram,
  loadAllPrograms,
  loadGroupPrograms,
  loadProgram,
  normalizeLectures,
  normalizeLessons,
  saveGroupPrograms,
  saveProgram,
  setGroupProgram,
  summarizeProgram,
} from '@/lib/curriculum';
import {
  buildRosterGroup,
  deleteRoster,
  loadRoster,
  loadRosterOverview,
  parseRosterText,
  saveRoster,
} from '@/lib/roster';

const redis = createRedisFromEnv();

const FACULTY_IDS = new Set<FacultyId>(['stomatology', 'therapeutic', 'pediatrics']);

function readFacultyId(body: Record<string, unknown>): FacultyId | null {
  const raw = String(body.facultyId || '').trim() as FacultyId;
  return FACULTY_IDS.has(raw) ? raw : null;
}

/** Сколько аккаунтов приложения приходится на каждую группу. */
async function countAccountsByGroup(): Promise<Record<string, number>> {
  const ids = await getAllUserIds(redis);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const raw: unknown = await redis.get(`user_id:${id}`);
    if (!raw || typeof raw !== 'object') continue;
    const user = raw as Record<string, unknown>;
    if (user.blocked === true) continue;
    const group = normalizeStudyGroup(String(user.studyGroup || ''));
    if (!group) continue;
    out[group] = (out[group] ?? 0) + 1;
  }
  return out;
}

async function buildState() {
  const [overlay, programs, groupPrograms, rosters] = await Promise.all([
    loadGroupCatalogOverlay(redis),
    loadAllPrograms(redis),
    loadGroupPrograms(redis),
    loadRosterOverview(redis),
  ]);

  return {
    ok: true,
    tree: buildGroupCatalogTree(overlay),
    hidden: {
      stomatology: listHiddenGroups('stomatology', overlay),
      therapeutic: listHiddenGroups('therapeutic', overlay),
      pediatrics:  listHiddenGroups('pediatrics', overlay),
    },
    programs: programs.map(summarizeProgram),
    groupPrograms,
    programGroupCounts: countGroupsPerProgram(groupPrograms),
    rosters,
    subjects: SUBJECTS.map(s => ({
      id: s.id,
      label: s.label,
      shortLabel: s.shortLabel,
      color: s.color,
      badge: s.badge,
    })),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { action } = body;
  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    if (action === 'state') {
      return res.status(200).json(await buildState());
    }

    // ─── Состав групп ───────────────────────────────────────────────────
    if (action === 'add_group') {
      const facultyId = readFacultyId(body);
      const digits = String(body.digits || '').replace(/\D/g, '');
      if (!facultyId || !digits) {
        return res.status(400).json({ error: 'Укажи факультет и номер группы.' });
      }
      const overlay = await loadGroupCatalogOverlay(redis);
      const result = addCustomGroup(overlay, {
        facultyId,
        digits,
        international: body.international === true,
        note: body.note ? String(body.note) : undefined,
      });
      if (!result) {
        return res.status(400).json({ error: 'Номер группы должен начинаться с курса: 208, 315.' });
      }
      await saveGroupCatalogOverlay(redis, result.overlay);
      return res.status(200).json({ ...(await buildState()), studyGroup: result.studyGroup });
    }

    if (action === 'remove_group') {
      const facultyId = readFacultyId(body);
      const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
      if (!facultyId || !studyGroup) {
        return res.status(400).json({ error: 'Укажи факультет и группу.' });
      }
      const overlay = await loadGroupCatalogOverlay(redis);
      await saveGroupCatalogOverlay(redis, removeGroupFromCatalog(overlay, facultyId, studyGroup));
      return res.status(200).json(await buildState());
    }

    if (action === 'restore_group') {
      const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
      if (!studyGroup) return res.status(400).json({ error: 'Укажи группу.' });
      const overlay = await loadGroupCatalogOverlay(redis);
      await saveGroupCatalogOverlay(redis, restoreHiddenGroup(overlay, studyGroup));
      return res.status(200).json(await buildState());
    }

    // ─── Программы кафедр ───────────────────────────────────────────────
    if (action === 'get_program') {
      const programId = String(body.programId || '').trim();
      if (!programId) return res.status(400).json({ error: 'Укажи программу.' });
      const program = await loadProgram(redis, programId);
      if (!program) return res.status(404).json({ error: 'Программа не найдена.' });
      return res.status(200).json({ ok: true, program });
    }

    if (action === 'save_program') {
      const facultyId = readFacultyId(body);
      const subjectId = String(body.subjectId || '').trim();
      const course = Number(body.course);
      if (!facultyId || !subjectId || !Number.isInteger(course) || course < 1) {
        return res.status(400).json({ error: 'Укажи факультет, курс и предмет.' });
      }
      if (!getSubject(subjectId)) {
        return res.status(400).json({ error: 'Неизвестный предмет.' });
      }

      const id = buildProgramId(facultyId, course, subjectId);
      const existing = await loadProgram(redis, id);
      const lessons: Lesson[] = body.lessons !== undefined
        ? normalizeLessons(body.lessons)
        : existing?.lessons ?? [];
      const lectures: Lecture[] = body.lectures !== undefined
        ? normalizeLectures(body.lectures)
        : existing?.lectures ?? [];

      const program: Program = {
        id,
        facultyId,
        course,
        subjectId,
        title: String(body.title || '').trim()
          || existing?.title
          || defaultProgramTitle(facultyId, course, subjectId),
        sourceDoc: body.sourceDoc !== undefined
          ? String(body.sourceDoc || '').trim() || undefined
          : existing?.sourceDoc,
        lessons,
        lectures,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saved = await saveProgram(redis, program);
      return res.status(200).json({ ...(await buildState()), program: saved });
    }

    if (action === 'delete_program') {
      const programId = String(body.programId || '').trim();
      if (!programId) return res.status(400).json({ error: 'Укажи программу.' });
      await deleteProgram(redis, programId);
      return res.status(200).json(await buildState());
    }

    // ─── Программы у групп ──────────────────────────────────────────────
    if (action === 'set_group_program') {
      const programId = String(body.programId || '').trim();
      const enabled = body.enabled === true || body.enabled === 'true';
      const groups = Array.isArray(body.studyGroups)
        ? body.studyGroups.map(g => normalizeStudyGroup(String(g))).filter(Boolean)
        : [normalizeStudyGroup(String(body.studyGroup || ''))].filter(Boolean);

      if (!programId || groups.length === 0) {
        return res.status(400).json({ error: 'Укажи программу и группы.' });
      }
      const program = await loadProgram(redis, programId);
      if (!program) return res.status(404).json({ error: 'Программа не найдена.' });

      let map = await loadGroupPrograms(redis);
      for (const group of groups) {
        map = setGroupProgram(map, group, programId, enabled);
      }
      await saveGroupPrograms(redis, map);
      return res.status(200).json({ ...(await buildState()), updated: groups.length });
    }

    // ─── Списки деканата ────────────────────────────────────────────────
    if (action === 'preview_roster') {
      const parsed = parseRosterText(String(body.text || ''));
      return res.status(200).json({
        ok: true,
        parsed: {
          digitsFromHeader: parsed.digitsFromHeader,
          specialty: parsed.specialty,
          count: parsed.students.length,
          students: parsed.students,
          skipped: parsed.skipped,
        },
      });
    }

    if (action === 'save_roster') {
      const facultyId = readFacultyId(body);
      if (!facultyId) return res.status(400).json({ error: 'Укажи факультет.' });

      const parsed = parseRosterText(String(body.text || ''));
      if (parsed.students.length === 0) {
        return res.status(400).json({ error: 'В тексте не найдено ни одного студента.' });
      }
      const roster = buildRosterGroup({
        facultyId,
        digits: String(body.digits || ''),
        parsed,
      });
      if (!roster) {
        return res.status(400).json({
          error: 'Не удалось определить номер группы — укажи его вручную.',
        });
      }
      await saveRoster(redis, roster);
      return res.status(200).json({
        ...(await buildState()),
        saved: { studyGroup: roster.studyGroup, count: roster.students.length },
        skipped: parsed.skipped,
      });
    }

    if (action === 'get_roster') {
      const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
      if (!studyGroup) return res.status(400).json({ error: 'Укажи группу.' });
      const roster = await loadRoster(redis, studyGroup);
      if (!roster) return res.status(404).json({ error: 'Список не загружен.' });
      const accounts = await countAccountsByGroup();
      return res.status(200).json({
        ok: true,
        roster,
        accounts: accounts[studyGroup] ?? 0,
      });
    }

    if (action === 'delete_roster') {
      const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
      if (!studyGroup) return res.status(400).json({ error: 'Укажи группу.' });
      await deleteRoster(redis, studyGroup);
      return res.status(200).json(await buildState());
    }

    if (action === 'accounts_by_group') {
      return res.status(200).json({ ok: true, accounts: await countAccountsByGroup() });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[admin-curriculum]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
