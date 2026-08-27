import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import {
  SUBJECTS, getSubject, getUserAvailableSubjects, migrateUserSubjects, applyBioTasksGift,
  ensureStomatologyBioTasksVisible,
  ensurePedTherBioTasksVisible,
  ensurePedTherChemTasksVisible,
} from '@/lib/subjects';
import {
  confirmPreviewUser,
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
} from '@/lib/preview';
import { applyGroupAccessToUser, loadGroupAccessRules } from '@/lib/groupAccess';
import type { PreviewModule } from '@/lib/previewModules';
import { clearAuthRateLimitsForTgId } from '@/lib/authRateLimit';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { getAllUserIds, registerUserId, removeUserId } from '@/lib/userIndex';
import { isValidTelegramUsername, normalizeTelegramUsername } from '@/lib/tgLinks';
import { resolveLastActivityIso } from '@/lib/userActivity';
import { facultyDisplayFromUser, healUserFacultyFields } from '@/lib/facultyCodes';

const redis        = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_TG_ID  = process.env.ADMIN_TG_ID || '978243325';
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const PAGE_SIZE    = 50;

type ListFilter = 'all' | 'blocked' | 'suspicious' | 'demo' | 'unpaid';
type ListSort   = 'registered' | 'lastActivity' | 'lastLogin' | 'loginCount';

function verifyAdmin(initData: string, secret: string): boolean {
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return false;
  if (!BOT_TOKEN) return false;
  const tgUser = verifyInitDataUser(initData, BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== ADMIN_TG_ID) return false;
  return true;
}

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

function toDetailUser(
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
    previewStartedAt:     user.previewStartedAt     ?? null,
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

  const pipeline1 = redis.pipeline();
  for (const id of ids) pipeline1.get(`user_id:${id}`);
  const rawUsers = await pipeline1.exec();

  const pipeline2 = redis.pipeline();
  for (const id of ids) {
    pipeline2.get(`opens:${id}:${today}`);
  }
  const opensData = await pipeline2.exec();

  const pipeline3 = redis.pipeline();
  for (const id of ids) pipeline3.sismember('used_demo_ids', id);
  const demoData = await pipeline3.exec();

  return ids.map((id, i) => {
    const user      = (rawUsers[i] as any) ?? {};
    const opens     = Number(opensData[i]) || 0;
    const usedDemo  = Boolean(demoData[i]);
    return toListUser(id, user, opens, usedDemo);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    initData, secret, action, tgId, subject, enable, reason, section, contactUsername: contactUsernameRaw,
    page, limit, filter, q, sortBy, sortDir,
  } = req.body ?? {};

  if (!initData || !secret || !verifyAdmin(String(initData), String(secret))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    if (action === 'gift_bio_tasks') {
      const ids = await getAllUserIds(redis);
      let updated = 0;
      let skipped = 0;
      for (const id of ids) {
        const raw: any = await redis.get(`user_id:${id}`);
        if (!raw) continue;
        const user = ensureSubjects(raw);
        const gifted = applyBioTasksGift(user);
        if (!gifted) {
          skipped++;
          continue;
        }
        await saveUser(id, gifted);
        updated++;
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

      const today = new Date().toISOString().slice(0, 10);
      const opensToday = Number(await redis.get(`opens:${id}:${today}`)) || 0;
      const usedDemo   = Boolean(await redis.sismember('used_demo_ids', id));

      return res.status(200).json({
        user: toDetailUser(id, user, opensToday, usedDemo),
      });
    }

    if (action && tgId) {
      let user: any = await redis.get(`user_id:${tgId}`);
      if (!user && action !== 'reset_demo' && action !== 'delete_user') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user) user = ensureSubjects(user);

      if (action === 'block') {
        const cleanReason = String(reason ?? '').trim().slice(0, 200) || 'manual';
        await saveUser(String(tgId), {
          ...user,
          blocked:       true,
          blockedReason: cleanReason,
          blockedAt:     new Date().toISOString(),
        });
        return res.status(200).json({ ok: true });
      }

      if (action === 'unblock') {
        const updated: Record<string, any> = { ...user };
        delete updated.blocked;
        delete updated.blockedReason;
        delete updated.blockedAt;
        await saveUser(String(tgId), updated);
        const today = new Date().toISOString().slice(0, 10);
        await redis.del(`opens:${tgId}:${today}`);
        await redis.del(`opens_notified:${tgId}:${today}`);
        return res.status(200).json({ ok: true });
      }

      if (action === 'toggle_subject') {
        const subjectId = String(subject || '').trim();
        const enabled   = enable === true || enable === 'true' || enable === '1';

        const cfg = getSubject(subjectId);
        if (!cfg) {
          return res.status(400).json({ error: `Unknown subject: ${subjectId}` });
        }

        const subjects = { ...(user.subjects || {}) };
        for (const s of SUBJECTS) {
          if (!(s.id in subjects)) subjects[s.id] = false;
        }
        subjects[subjectId] = enabled;

        const ALL_SECTIONS = ['questions', 'tests', 'tasks', 'exam', 'materials'];

        const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
        if (enabled) {
          navHidden[subjectId] = ALL_SECTIONS;
        } else {
          delete navHidden[subjectId];
        }

        const updated: any = { ...user, subjects, navHidden, _migrated_subjects: true };

        if (enabled) {
          updated[`${subjectId}_grantedAt`] = new Date().toISOString();
        } else {
          delete updated[`${subjectId}_grantedAt`];
        }

        if (subjectId === 'micro') {
          if (enabled) {
            updated.micro          = true;
            updated.microGrantedAt = new Date().toISOString();
          } else {
            delete updated.micro;
            delete updated.microGrantedAt;
            delete updated.microKey;
            delete updated.microDate;
          }
        }

        let healed = applyAdminAccessHeals(updated);
        if (enabled && user.paid === true) {
          healed = applyAdminAccessHeals({ ...healed, paid: true });
        }
        await saveUser(String(tgId), healed);
        return res.status(200).json({
          ok: true,
          subjects: getUserAvailableSubjects(healed),
          navHidden: healed.navHidden ?? navHidden,
          previewStatus: healed.previewStatus ?? null,
          previewConfirmedAt: healed.previewConfirmedAt ?? null,
          previewChosenSubject: healed.previewChosenSubject ?? null,
        });
      }

      if (action === 'give_micro') {
        const subjects = { ...(user.subjects || {}) };
        for (const s of SUBJECTS) if (!(s.id in subjects)) subjects[s.id] = false;
        subjects.micro = true;
        await saveUser(String(tgId), {
          ...user,
          subjects,
          micro:              true,
          microGrantedAt:     new Date().toISOString(),
          _migrated_subjects: true,
        });
        return res.status(200).json({ ok: true });
      }

      if (action === 'revoke_micro') {
        const subjects = { ...(user.subjects || {}) };
        for (const s of SUBJECTS) if (!(s.id in subjects)) subjects[s.id] = false;
        subjects.micro = false;
        const u: Record<string, any> = { ...user, subjects, _migrated_subjects: true };
        delete u.micro;
        delete u.microGrantedAt;
        delete u.microKey;
        delete u.microDate;
        await saveUser(String(tgId), u);
        return res.status(200).json({ ok: true });
      }

      if (action === 'reset_demo') {
        const id = String(tgId).trim();
        await clearPreviewTrialLockForUser(id);
        await clearAuthRateLimitsForTgId(redis, id);
        let cleaned: Record<string, any> | null = null;
        if (user) {
          const patched = resetPreviewDemoAccess(user);
          await saveUser(id, patched);
          cleaned = patched;
        }
        const today = new Date().toISOString().slice(0, 10);
        const opensToday = Number(await redis.get(`opens:${id}:${today}`)) || 0;
        const usedDemo   = Boolean(await redis.sismember('used_demo_ids', id));
        const detail = cleaned ? toDetailUser(id, cleaned, opensToday, usedDemo) : null;
        return res.status(200).json({
          ok: true,
          subjects: detail?.subjects ?? [],
          navHidden: detail?.navHidden ?? {},
          user: detail,
        });
      }

      if (action === 'grant_direct_access') {
        const granted = adminGrantDirectAccess(user);
        if (!granted) {
          return res.status(400).json({
            error: 'Нет выбранного предмета. Попроси студента выбрать предмет или открой вручную.',
          });
        }
        let updated = granted;
        try {
          const rules = await loadGroupAccessRules(redis);
          const merged = applyGroupAccessToUser(updated, rules);
          updated = merged.user;
        } catch { /* групповые правила — best effort */ }
        updated = applyAdminAccessHeals(updated);
        await saveUser(String(tgId), updated);
        const today = new Date().toISOString().slice(0, 10);
        const opensToday = Number(await redis.get(`opens:${String(tgId)}:${today}`)) || 0;
        const usedDemo = Boolean(await redis.sismember('used_demo_ids', String(tgId)));
        const detail = toDetailUser(String(tgId), updated, opensToday, usedDemo);
        return res.status(200).json({
          ok: true,
          subjects: getUserAvailableSubjects(updated),
          navHidden: updated.navHidden ?? {},
          previewStatus: null,
          previewConfirmedAt: updated.previewConfirmedAt ?? null,
          previewChosenSubject: null,
          previewChosenModules: null,
          previewNeedsConfirm: false,
          previewPendingModules: [],
          previewDisplayModules: [],
          receiptClaimedAt: null,
          paid: updated.paid === true,
          studyGroup: updated.studyGroup ?? null,
          user: detail,
        });
      }

      if (action === 'force_payment_only') {
        const updated = adminForcePaymentOnlyScreen(user);
        if (!updated) {
          return res.status(400).json({ error: 'Не удалось определить предмет или разделы для оплаты.' });
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({
          ok: true,
          previewStatus: updated.previewStatus ?? null,
          previewChosenSubject: updated.previewChosenSubject ?? null,
          previewChosenModules: updated.previewChosenModules ?? null,
          previewQuotedPrice: updated.previewQuotedPrice ?? null,
          previewNeedsConfirm: previewChoiceNeedsAdminConfirm(updated),
              previewPendingModules: getPendingAdminModules(updated),
              previewDisplayModules: getPreviewChosenModulesForAdmin(updated),
              previewConfirmedAt: null,
          receiptClaimedAt: null,
          subjects: getUserAvailableSubjects(updated),
          navHidden: updated.navHidden ?? {},
          paid: updated.paid === true,
        });
      }

      if (action === 'reopen_preview_vitrine') {
        const updated = reopenPreviewVitrine(user);
        if (!updated) {
          return res.status(400).json({ error: 'Не удалось вернуть на витрину' });
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({
          ok: true,
          previewStatus: 'selecting',
          previewChosenSubject: null,
          previewChosenModules: null,
          previewQuotedPrice: null,
          receiptClaimedAt: null,
          previewNeedsConfirm: false,
        });
      }

      if (action === 'confirm_preview_module') {
        const mod = String(req.body?.module || '').trim() as PreviewModule;
        if (!['questions', 'tests', 'tasks'].includes(mod)) {
          return res.status(400).json({ error: 'Неизвестный раздел.' });
        }
        if (!user?.previewChosenSubject) {
          return res.status(400).json({ error: 'Предмет не выбран' });
        }
        const updated = confirmPreviewModule(user, mod);
        if (!updated) {
          return res.status(400).json({ error: 'Нельзя подтвердить этот раздел сейчас.' });
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({
          ok: true,
          subjects: getUserAvailableSubjects(updated),
          navHidden: updated.navHidden ?? {},
          previewStatus: updated.previewStatus ?? null,
          previewConfirmedAt: updated.previewConfirmedAt ?? null,
          previewChosenSubject: updated.previewChosenSubject ?? null,
          previewChosenModules: updated.previewChosenModules ?? null,
          previewPendingModules: getPendingAdminModules(updated),
          previewDisplayModules: getPreviewChosenModulesForAdmin(updated),
          previewNeedsConfirm: previewChoiceNeedsAdminConfirm(updated),
          paid: updated.paid === true,
        });
      }

      if (action === 'reject_preview_module') {
        const mod = String(req.body?.module || '').trim() as PreviewModule;
        if (!['questions', 'tests', 'tasks'].includes(mod)) {
          return res.status(400).json({ error: 'Неизвестный раздел.' });
        }
        if (!user?.previewChosenSubject) {
          return res.status(400).json({ error: 'Предмет не выбран' });
        }
        const updated = rejectPreviewModule(user, mod);
        if (!updated) {
          return res.status(400).json({ error: 'Нельзя отказать по этому разделу сейчас.' });
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({
          ok: true,
          subjects: getUserAvailableSubjects(updated),
          navHidden: updated.navHidden ?? {},
          previewStatus: updated.previewStatus ?? null,
          previewConfirmedAt: updated.previewConfirmedAt ?? null,
          previewChosenSubject: updated.previewChosenSubject ?? null,
          previewChosenModules: updated.previewChosenModules ?? null,
          previewPendingModules: getPendingAdminModules(updated),
          previewDisplayModules: getPreviewChosenModulesForAdmin(updated),
          previewNeedsConfirm: previewChoiceNeedsAdminConfirm(updated),
          receiptClaimedAt: updated.receiptClaimedAt ?? null,
          paid: updated.paid === true,
        });
      }

      if (action === 'confirm_preview') {
        if (!user?.previewChosenSubject) {
          return res.status(400).json({ error: 'Предмет не выбран' });
        }
        if (hasFinalizedPreviewAccess(user)) {
          return res.status(200).json({
            ok: true,
            subjects: getUserAvailableSubjects(user),
            navHidden: user.navHidden ?? {},
            previewConfirmedAt: user.previewConfirmedAt ?? null,
          });
        }
        const pending = getPendingAdminModules(user);
        if (pending.length === 1) {
          const updated = confirmPreviewModule(user, pending[0]);
          if (updated) {
            await saveUser(String(tgId), updated);
            return res.status(200).json({
              ok: true,
              subjects: getUserAvailableSubjects(updated),
              navHidden: updated.navHidden ?? {},
              previewStatus: updated.previewStatus ?? null,
              previewConfirmedAt: updated.previewConfirmedAt ?? null,
              previewChosenSubject: updated.previewChosenSubject ?? null,
              previewChosenModules: updated.previewChosenModules ?? null,
              previewPendingModules: getPendingAdminModules(updated),
              previewDisplayModules: getPreviewChosenModulesForAdmin(updated),
              previewNeedsConfirm: previewChoiceNeedsAdminConfirm(updated),
              paid: updated.paid === true,
            });
          }
        }
        const updated = confirmPreviewUser(user);
        if (!updated) {
          return res.status(400).json({
            error: 'Не удалось определить выбранные разделы. Попроси студента выбрать заново.',
          });
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({
          ok: true,
          subjects: getUserAvailableSubjects(updated),
          navHidden: updated.navHidden ?? {},
          previewStatus: null,
          previewConfirmedAt: updated.previewConfirmedAt ?? null,
          previewChosenSubject: updated.previewChosenSubject ?? null,
          previewChosenModules: updated.previewChosenModules ?? null,
          paid: updated.paid === true,
        });
      }

      if (action === 'toggle_paid') {
        const newPaid = !user.paid;
        let updated = { ...user, paid: newPaid };
        if (newPaid) {
          updated = healStalePreviewForFinalizedUser(updated);
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({ ok: true, paid: newPaid });
      }

      if (action === 'set_contact_username') {
        const raw = String(contactUsernameRaw ?? reason ?? '').trim();
        const updated: Record<string, unknown> = { ...user };
        if (!raw) {
          delete updated.contactUsername;
        } else {
          const handle = normalizeTelegramUsername(raw);
          if (!isValidTelegramUsername(handle)) {
            return res.status(400).json({ error: 'Некорректный username (5–32 символа, латиница)' });
          }
          updated.contactUsername = handle;
        }
        await saveUser(String(tgId), updated);
        return res.status(200).json({
          ok: true,
          contactUsername: (updated.contactUsername as string | undefined) ?? null,
        });
      }

      if (action === 'delete_user') {
        const id = String(tgId).trim();
        const key = String(user?.activatedKey || '').trim();
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
            const [nextCur, keys] = await redis.scan(cur, { match: `opens*:${id}:*`, count: 100 });
            cur = Number(nextCur);
            if ((keys as string[]).length) {
              await redis.del(...(keys as [string, ...string[]]));
            }
          } while (cur !== 0);
        } catch { /* не критично */ }
        return res.status(200).json({ ok: true });
      }

      if (action === 'toggle_section') {
        const subjectId = String(subject || '').trim();
        const sectionId = String(section || '').trim();
        const enabled   = enable === true || enable === 'true' || enable === '1';
        const ALLOWED_SECTIONS = ['lessons', 'questions', 'tests', 'tasks', 'exam', 'materials'];
        if (!subjectId || !ALLOWED_SECTIONS.includes(sectionId)) {
          return res.status(400).json({ error: 'Bad subject/section' });
        }
        const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
        const set = new Set<string>(navHidden[subjectId] || []);
        if (enabled) set.delete(sectionId); else set.add(sectionId);
        if (set.size === 0) delete navHidden[subjectId]; else navHidden[subjectId] = [...set];
        const healed = applyAdminAccessHeals({ ...user, navHidden });
        await saveUser(String(tgId), healed);
        return res.status(200).json({
          ok: true,
          navHidden: healed.navHidden ?? navHidden,
          previewStatus: healed.previewStatus ?? null,
          previewConfirmedAt: healed.previewConfirmedAt ?? null,
          previewChosenSubject: healed.previewChosenSubject ?? null,
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // ── Список пользователей (пагинация + фильтры на сервере) ───────────────
    const ids = await getAllUserIds(redis);
    const allUsers = await buildUserList(ids);

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
    const browsingTop50 = listFilter === 'all' && !query;
    const pageNum  = browsingTop50 ? 1 : Math.max(1, Number(page) || 1);
    const start    = (pageNum - 1) * pageSize;
    const slice    = filtered.slice(start, start + pageSize);

    const blockedCount    = allUsers.filter(u => u.blocked).length;
    const suspiciousCount = allUsers.filter(u => u.suspicious && !u.blocked).length;
    const demoCount       = allUsers.filter(u => u.usedDemo || u.previewStatus).length;
    const unpaidCount     = allUsers.filter(isUnpaid).length;
    const microCount      = allUsers.filter(u => u.subjects.some(s => s !== 'ortho')).length;

    return res.status(200).json({
      users: slice,
      total: allUsers.length,
      filteredTotal: filtered.length,
      page: pageNum,
      pageSize,
      hasMore: browsingTop50 ? false : start + pageSize < filtered.length,
      sortBy: listSort,
      sortDir: listSortDir,
      demoCount,
      unpaidCount,
      blockedCount,
      suspiciousCount,
      microCount,
      availableSubjects: subjectPayload(),
    });

  } catch (err) {
    console.error('[admin-users] error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
