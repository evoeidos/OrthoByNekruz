import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import {
  SUBJECTS, getSubject, migrateUserSubjects, applyBioTasksGift,
  ensureStomatologyBioTasksVisible,
  ensurePedTherBioTasksVisible,
  ensurePedTherChemTasksVisible,
} from '@/lib/subjects';
import {
  confirmPreviewModule,
  rejectPreviewModule,
  getEffectiveUserSubjects,
  clearPreviewTrialLock,
  previewChoiceNeedsAdminConfirm,
  previewChoiceIsAddon,
  hasFinalizedPreviewAccess,
  healStalePreviewForFinalizedUser,
  healExamNavHidden,
  clearPreviewFlowIfAdminGrantedAccess,
  reopenPreviewVitrine,
  getPendingAdminModules,
  getPreviewChosenModulesForAdmin,
  adminForcePaymentOnlyScreen,
  resetPreviewDemoAccess,
  adminGrantDirectAccess,
  type DirectGrantItem,
} from '@/lib/preview';
import { applyGroupAccessToUser, loadGroupAccessRules } from '@/lib/groupAccess';
import { normalizePreviewModules, type PreviewModule } from '@/lib/previewModules';
import { clearAuthRateLimitsForTgId } from '@/lib/authRateLimit';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { isUserLockTimeout, withUserLock, withUserLockResponse } from '@/lib/userLock';
import { alertAdmin } from '@/lib/alertAdmin';
import { getAllUserIds, registerUserId, removeUserId } from '@/lib/userIndex';
import { isValidTelegramUsername, normalizeTelegramUsername } from '@/lib/tgLinks';
import { resolveLastActivityIso } from '@/lib/userActivity';
import { facultyDisplayFromUser, healUserFacultyFields } from '@/lib/facultyCodes';
import { buildStudyGroupFromDigits, normalizeStudyGroup } from '@/lib/studyGroup';

const redis     = createRedisFromEnv();
const PAGE_SIZE = 50;

type ListFilter = 'all' | 'blocked' | 'suspicious' | 'demo' | 'unpaid';
type ListSort   = 'registered' | 'lastActivity' | 'lastLogin' | 'loginCount';

function ensureSubjects(user: any): any {
  return migrateUserSubjects(user);
}

function subjectPayload() {
  return SUBJECTS.map(s => ({
    id:         s.id,
    label:      s.label,
    shortLabel: s.shortLabel,
    color:      s.color,
  }));
}

function isSuspicious(opensToday: number): boolean {
  return opensToday >= 5;
}

async function clearPreviewTrialLockForUser(tgId: string) {
  await clearPreviewTrialLock(redis, tgId);
}

function toListUser(
  id: string,
  user: any,
  opensToday: number,
  usedDemo: boolean,
) {
  user = ensureSubjects(user);
  const facultyDisplay = facultyDisplayFromUser(user);
  const userSubjects = getEffectiveUserSubjects(user);
  return {
    tgId:          id,
    username:      user.username      ?? null,
    firstName:     user.firstName     ?? null,
    lastName:      user.lastName      ?? null,
    blocked:       user.blocked === true,
    blockedReason: user.blockedReason ?? null,
    blockedAt:     user.blockedAt     ?? null,
    subjects:      userSubjects,
    hasMicro:      userSubjects.includes('micro'),
    usedDemo,
    previewStatus:        user.previewStatus        ?? null,
    previewChosenSubject: user.previewChosenSubject ?? null,
    previewChosenModules: Array.isArray(user.previewChosenModules) ? user.previewChosenModules : null,
    previewDisplayModules: getPreviewChosenModulesForAdmin(user),
    promoCode:            user.promoCode            ?? facultyDisplay?.code ?? null,
    facultyId:            user.facultyId            ?? facultyDisplay?.facultyId ?? null,
    previewFaculty:       user.previewFaculty       ?? null,
    facultyDisplayLabel:  facultyDisplay?.label     ?? null,
    facultyDisplayCode:   facultyDisplay?.code      ?? null,
    facultyIcon:          facultyDisplay?.icon      ?? null,
    previewConfirmedAt:   user.previewConfirmedAt   ?? null,
    previewQuotedPrice:   typeof user.previewQuotedPrice === 'number' ? user.previewQuotedPrice : null,
    receiptClaimedAt:     user.receiptClaimedAt     ?? null,
    previewNeedsConfirm:  previewChoiceNeedsAdminConfirm(user),
    previewPendingModules: getPendingAdminModules(user),
    previewIsAddon:       previewChoiceIsAddon(user),
    contactUsername:      user.contactUsername      ?? null,
    studyGroup:           user.studyGroup           ?? null,
    activatedKey:  user.activatedKey  ?? null,
    registeredAt:    user.date          ?? null,
    lastLogin:       user.lastLogin     ?? null,
    lastActivityAt:  resolveLastActivityIso(user),
    loginCount:      Number(user.loginCount) || 0,
    opensToday,
    suspicious:    isSuspicious(opensToday),
    navHidden:     (user.navHidden && typeof user.navHidden === 'object') ? user.navHidden : {},
    paid:          user.paid === true,
  };
}

/** Карточка в развёрнутом виде — то же плюс время начала пробника. */
function toDetailUser(
  id: string,
  user: any,
  opensToday: number,
  usedDemo: boolean,
) {
  return {
    ...toListUser(id, user, opensToday, usedDemo),
    previewStartedAt: user.previewStartedAt ?? null,
  };
}

async function loadDetail(id: string, user: any) {
  const today = new Date().toISOString().slice(0, 10);
  const [opens, demo] = await Promise.all([
    redis.get(`opens:${id}:${today}`),
    redis.sismember('used_demo_ids', id),
  ]);
  return toDetailUser(id, user, Number(opens) || 0, Boolean(demo));
}

/** Разбор выбора админа для «Открыть доступ»: [{ subject, modules }]. */
function parseGrantPlan(raw: unknown): DirectGrantItem[] | null {
  if (!Array.isArray(raw)) return null;
  const plan: DirectGrantItem[] = [];
  for (const item of raw) {
    const id = String((item as any)?.subject ?? '').trim();
    const modules = normalizePreviewModules((item as any)?.modules);
    if (!getSubject(id) || modules.length === 0) continue;
    plan.push({ id, modules });
  }
  return plan;
}

/** Админ ещё не отметил оплату (в т.ч. заявка до подтверждения доступа). */
function isUnpaid(u: ReturnType<typeof toListUser>): boolean {
  if (u.paid === true) return false;
  if (u.previewNeedsConfirm) return true;

  if (u.subjects.length === 0) return false;

  const key = u.activatedKey;
  if (!key || key === 'trial') return false;

  if (key !== 'preview' && !String(key).startsWith('promo:')) {
    return true;
  }

  return hasFinalizedPreviewAccess({ previewStatus: u.previewStatus, previewConfirmedAt: u.previewConfirmedAt });
}

function matchesQuery(u: ReturnType<typeof toListUser>, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^@/, '');
  if (!needle) return true;
  const hay = [u.tgId, u.username, u.firstName, u.lastName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (hay.includes(needle)) return true;
  if (u.username && u.username.toLowerCase().includes(needle)) return true;
  return false;
}

function sortUsers(
  list: ReturnType<typeof toListUser>[],
  sortBy: ListSort,
  sortDir: 'asc' | 'desc',
) {
  return [...list].sort((a, b) => {
    if (sortBy === 'loginCount') {
      const diff = b.opensToday - a.opensToday;
      if (diff !== 0) return diff;
      return b.loginCount - a.loginCount;
    }
    if (sortBy === 'lastActivity' || sortBy === 'lastLogin') {
      const ta = a.lastActivityAt
        ? Date.parse(a.lastActivityAt)
        : (a.registeredAt ? Date.parse(a.registeredAt) : 0);
      const tb = b.lastActivityAt
        ? Date.parse(b.lastActivityAt)
        : (b.registeredAt ? Date.parse(b.registeredAt) : 0);
      return tb - ta;
    }
    const ta = a.registeredAt ? Date.parse(a.registeredAt) : 0;
    const tb = b.registeredAt ? Date.parse(b.registeredAt) : 0;
    return sortDir === 'asc' ? ta - tb : tb - ta;
  });
}

async function saveUser(tgId: string, data: any) {
  const { user: healed } = healUserFacultyFields(data);
  await redis.set(`user_id:${tgId}`, healed);
  await registerUserId(redis, tgId);
}

function applyAdminAccessHeals(user: any): any {
  let healed = healStalePreviewForFinalizedUser(user);
  healed = healExamNavHidden(healed);
  healed = clearPreviewFlowIfAdminGrantedAccess(healed);
  healed = healUserFacultyFields(healed).user;
  const stomTasks = ensureStomatologyBioTasksVisible(healed);
  if (stomTasks) healed = stomTasks;
  const pedBioTasks = ensurePedTherBioTasksVisible(healed);
  if (pedBioTasks) healed = pedBioTasks;
  const chemTasks = ensurePedTherChemTasksVisible(healed);
  if (chemTasks) healed = chemTasks;
  return healed;
}

async function buildUserList(ids: string[]) {
  if (!ids.length) return [];

  const today = new Date().toISOString().slice(0, 10);

  // Один проход: на каждого пользователя — запись, открытия за сегодня, демо.
  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`user_id:${id}`);
    pipeline.get(`opens:${id}:${today}`);
    pipeline.sismember('used_demo_ids', id);
  }
  const rows = await pipeline.exec();

  const list: ReturnType<typeof toListUser>[] = [];
  ids.forEach((id, i) => {
    const user = rows[i * 3] as any;
    // Индекс мог отстать от удалённой записи — такую строку не показываем.
    if (!user || typeof user !== 'object') return;
    list.push(toListUser(id, user, Number(rows[i * 3 + 1]) || 0, Boolean(rows[i * 3 + 2])));
  });
  return list;
}

const ADMIN_PREVIEW_MODULES: PreviewModule[] = ['questions', 'tests', 'tasks'];
const NAV_SECTION_IDS = ['lessons', 'questions', 'tests', 'tasks', 'exam', 'materials'];

type ActionResult = { user: any } | { error: string };

/**
 * Действие админа над одним пользователем: возвращает новую запись (или ту же,
 * если менять нечего) либо текст ошибки. Запись и ответ — в обработчике.
 */
async function applyUserAction(
  user: any,
  action: string,
  body: Record<string, any>,
): Promise<ActionResult> {
  switch (action) {
    case 'block':
      return {
        user: {
          ...user,
          blocked:       true,
          blockedReason: String(body.reason ?? '').trim().slice(0, 200) || 'manual',
          blockedAt:     new Date().toISOString(),
        },
      };

    case 'unblock': {
      const updated = { ...user };
      delete updated.blocked;
      delete updated.blockedReason;
      delete updated.blockedAt;
      return { user: updated };
    }

    case 'toggle_subject': {
      const subjectId = String(body.subject || '').trim();
      const enabled = body.enable === true;
      if (!getSubject(subjectId)) return { error: `Неизвестный предмет: ${subjectId}` };

      const subjects = { ...(user.subjects || {}) };
      for (const s of SUBJECTS) if (!(s.id in subjects)) subjects[s.id] = false;
      subjects[subjectId] = enabled;

      // Предмет выдаётся с закрытыми разделами: их админ включает ниже в
      // карточке (или сразу через «Открыть доступ» с выбором разделов).
      const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
      if (enabled) navHidden[subjectId] = ['questions', 'tests', 'tasks', 'exam', 'materials'];
      else delete navHidden[subjectId];

      const updated: any = { ...user, subjects, navHidden, _migrated_subjects: true };
      if (enabled) updated[`${subjectId}_grantedAt`] = new Date().toISOString();
      else delete updated[`${subjectId}_grantedAt`];

      if (subjectId === 'micro') {
        if (enabled) {
          updated.micro = true;
          updated.microGrantedAt = new Date().toISOString();
        } else {
          delete updated.micro;
          delete updated.microGrantedAt;
          delete updated.microKey;
          delete updated.microDate;
        }
      }
      return { user: applyAdminAccessHeals(updated) };
    }

    case 'toggle_section': {
      const subjectId = String(body.subject || '').trim();
      const sectionId = String(body.section || '').trim();
      const enabled = body.enable === true;
      if (!getSubject(subjectId) || !NAV_SECTION_IDS.includes(sectionId)) {
        return { error: 'Неизвестный предмет или раздел' };
      }
      const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
      const hidden = new Set<string>(navHidden[subjectId] || []);
      if (enabled) hidden.delete(sectionId); else hidden.add(sectionId);
      if (hidden.size === 0) delete navHidden[subjectId]; else navHidden[subjectId] = [...hidden];
      return { user: applyAdminAccessHeals({ ...user, navHidden }) };
    }

    case 'grant_direct_access': {
      const plan = parseGrantPlan(body.grants);
      if (plan && plan.length === 0) return { error: 'Выбери хотя бы один предмет и раздел.' };
      const granted = adminGrantDirectAccess(user, plan ?? undefined);
      if (!granted) return { error: 'Студент ещё не выбрал предмет — отметь предметы и разделы вручную.' };
      let updated = granted;
      try {
        updated = applyGroupAccessToUser(updated, await loadGroupAccessRules(redis)).user;
      } catch { /* групповые правила — best effort */ }
      return { user: applyAdminAccessHeals(updated) };
    }

    case 'force_payment_only': {
      const updated = adminForcePaymentOnlyScreen(user);
      if (!updated) return { error: 'Нет предмета для оплаты: студент ничего не выбирал и доступов нет.' };
      return { user: updated };
    }

    case 'reopen_preview_vitrine': {
      const updated = reopenPreviewVitrine(user);
      if (!updated) return { error: 'Не удалось вернуть на витрину' };
      return { user: updated };
    }

    case 'confirm_preview_module':
    case 'reject_preview_module': {
      const mod = String(body.module || '').trim() as PreviewModule;
      if (!ADMIN_PREVIEW_MODULES.includes(mod)) return { error: 'Неизвестный раздел.' };
      if (!user.previewChosenSubject) return { error: 'Студент не выбрал предмет' };
      const updated = action === 'confirm_preview_module'
        ? confirmPreviewModule(user, mod)
        : rejectPreviewModule(user, mod);
      if (!updated) return { error: 'Заявка по этому разделу уже обработана — обнови список.' };
      return { user: updated };
    }

    // Сменить закреплённую группу (студент сам её поменять не может — см.
    // set_study_group в auth.ts). Цифры группы, буква факультета — по студенту.
    case 'set_study_group': {
      const facultyId = String(user.facultyId || '').trim() || null;
      const built = buildStudyGroupFromDigits(String(body.studyGroup ?? ''), facultyId);
      if (!built) {
        return { error: facultyId ? 'Введи номер группы цифрами, например 108' : 'У студента не выбран факультет' };
      }
      const group = normalizeStudyGroup(built);
      const rules = await loadGroupAccessRules(redis);
      return {
        user: applyGroupAccessToUser({ ...user, studyGroup: group, lockedStudyGroup: group }, rules).user,
      };
    }

    case 'toggle_paid': {
      const paid = !user.paid;
      const updated = { ...user, paid };
      return { user: paid ? healStalePreviewForFinalizedUser(updated) : updated };
    }

    case 'set_contact_username': {
      const raw = String(body.contactUsername ?? '').trim();
      const updated: Record<string, unknown> = { ...user };
      if (!raw) {
        delete updated.contactUsername;
      } else {
        const handle = normalizeTelegramUsername(raw);
        if (!isValidTelegramUsername(handle)) return { error: 'Некорректный username (5–32 символа, латиница)' };
        updated.contactUsername = handle;
      }
      return { user: updated };
    }

    default:
      return { error: 'Неизвестное действие' };
  }
}

/**
 * Действие над одним пользователем выполняется под его блокировкой
 * (src/lib/userLock.ts): чтение, правка и запись не перемешаются с
 * параллельным запросом студента — подтверждение оплаты не затрётся.
 * Блокировку берём только после проверки прав админа.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { action, tgId } = req.body ?? {};
  if (req.method !== 'POST' || !action || !tgId || action === 'gift_bio_tasks') {
    return handleAdminUsers(req, res);
  }
  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  try {
    return await withUserLockResponse(redis, String(tgId), res, lockedRes => handleAdminUsers(req, lockedRes), `admin:${action}`);
  } catch (e) {
    if (isUserLockTimeout(e)) {
      return res.status(503).json({ error: 'Студент сейчас что-то делает в приложении — повтори через пару секунд.' });
    }
    throw e;
  }
}

async function handleAdminUsers(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, tgId, page, filter, q, sortBy, sortDir } = req.body ?? {};

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    if (action === 'gift_bio_tasks') {
      const ids = await getAllUserIds(redis);
      let updated = 0;
      let skipped = 0;
      for (const id of ids) {
        const raw: any = await redis.get(`user_id:${id}`);
        if (!raw) continue;
        if (!applyBioTasksGift(ensureSubjects(raw))) {
          skipped++;
          continue;
        }
        // Под блокировкой: подарок применяется к свежей копии пользователя.
        let gifted = false;
        await withUserLock(redis, id, async () => {
          const fresh: any = await redis.get(`user_id:${id}`);
          const next = fresh ? applyBioTasksGift(ensureSubjects(fresh)) : null;
          if (next) {
            await saveUser(id, next);
            gifted = true;
          }
        }, 'admin:gift_bio_tasks');
        if (gifted) updated++; else skipped++;
      }
      return res.status(200).json({
        ok: true,
        updated,
        skipped,
        total: ids.length,
      });
    }

    if (action === 'get_user' && tgId) {
      const id = String(tgId);
      let user: any = await redis.get(`user_id:${id}`);
      if (!user) return res.status(404).json({ error: 'User not found' });
      user = ensureSubjects(user);
      const facultyHeal = healUserFacultyFields(user);
      if (facultyHeal.changed) {
        await saveUser(id, facultyHeal.user);
        user = facultyHeal.user;
      }

      return res.status(200).json({ user: await loadDetail(id, user) });
    }

    if (action && tgId) {
      const id = String(tgId).trim();
      let user: any = await redis.get(`user_id:${id}`);
      if (user) user = ensureSubjects(user);

      // Сброс пробника и удаление работают и без записи (чистят хвосты по ID).
      if (action === 'reset_demo') {
        await clearPreviewTrialLockForUser(id);
        await clearAuthRateLimitsForTgId(redis, id);
        if (!user) return res.status(200).json({ ok: true, user: null });
        const updated = resetPreviewDemoAccess(user);
        await saveUser(id, updated);
        return res.status(200).json({ ok: true, user: await loadDetail(id, updated) });
      }

      if (action === 'delete_user') {
        const key = String(user?.activatedKey || '').trim();
        // 8-значный ключ возвращается в пул — его можно выдать другому.
        if (/^\d{8}$/.test(key)) {
          await redis.sadd('valid_keys', key);
        }
        await redis.del(`user_id:${id}`);
        await removeUserId(redis, id);
        await clearPreviewTrialLockForUser(id);
        await clearAuthRateLimitsForTgId(redis, id);
        try {
          let cur = 0;
          do {
            const [nextCur, keys] = await redis.scan(cur, { match: `opens*:${id}:*`, count: 1000 });
            cur = Number(nextCur);
            if ((keys as string[]).length) {
              await redis.del(...(keys as [string, ...string[]]));
            }
          } while (cur !== 0);
        } catch { /* не критично */ }
        return res.status(200).json({ ok: true });
      }

      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

      const result = await applyUserAction(user, String(action), req.body ?? {});
      if ('error' in result) return res.status(400).json({ error: result.error });

      if (result.user !== user) await saveUser(id, result.user);
      if (action === 'unblock') {
        const today = new Date().toISOString().slice(0, 10);
        await redis.del(`opens:${id}:${today}`, `opens_notified:${id}:${today}`);
      }
      return res.status(200).json({ ok: true, user: await loadDetail(id, result.user) });
    }

    // ── Список пользователей (пагинация + фильтры на сервере) ───────────────
    const ids = await getAllUserIds(redis);
    const allUsers = await buildUserList(ids);

    const counts = {
      total:           allUsers.length,
      blockedCount:    allUsers.filter(u => u.blocked).length,
      suspiciousCount: allUsers.filter(u => u.suspicious && !u.blocked).length,
      demoCount:       allUsers.filter(u => u.usedDemo || u.previewStatus).length,
      unpaidCount:     allUsers.filter(isUnpaid).length,
      // ortho открыт всем по умолчанию — считаем тех, у кого есть что-то сверх него.
      accessCount:     allUsers.filter(u => u.subjects.some(s => s !== 'ortho')).length,
    };
    if (req.body?.countsOnly === true) return res.status(200).json(counts);

    const listFilter = (['all', 'blocked', 'suspicious', 'demo', 'unpaid'].includes(filter)
      ? filter
      : 'all') as ListFilter;
    const listSort = (['registered', 'lastActivity', 'lastLogin', 'loginCount'].includes(sortBy)
      ? (sortBy === 'lastLogin' ? 'lastActivity' : sortBy)
      : 'lastActivity') as ListSort;
    const listSortDir: 'asc' | 'desc' =
      sortDir === 'asc' && listSort === 'registered' ? 'asc' : 'desc';
    const query = String(q ?? '').trim().toLowerCase();

    let filtered = allUsers.filter(u => {
      if (listFilter === 'blocked'    && !u.blocked) return false;
      if (listFilter === 'suspicious' && !u.suspicious && !u.blocked) return false;
      if (listFilter === 'demo'       && !u.usedDemo && !u.previewStatus) return false;
      if (listFilter === 'unpaid'     && !isUnpaid(u)) return false;
      if (query && !matchesQuery(u, query)) return false;
      return true;
    });

    filtered = sortUsers(filtered, listSort, listSortDir);

    const pageSize = PAGE_SIZE;
    const pageNum  = Math.max(1, Math.floor(Number(page)) || 1);
    const start    = (pageNum - 1) * pageSize;
    const slice    = filtered.slice(start, start + pageSize);


    return res.status(200).json({
      ...counts,
      users: slice,
      filteredTotal: filtered.length,
      page: pageNum,
      pageSize,
      hasMore: start + pageSize < filtered.length,
      sortBy: listSort,
      sortDir: listSortDir,
      availableSubjects: subjectPayload(),
    });

  } catch (err) {
    console.error('[admin-users] error:', err);
    alertAdmin('admin-users:500', 'админка: ошибка сервера', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
