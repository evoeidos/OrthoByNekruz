import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import {
  SUBJECTS,
  getSubject,
  getUserAvailableSubjects,
  createDefaultSubjects,
  migrateUserSubjects,
  ensureStomatologyBioTasksVisible,
  ensurePedTherBioTasksVisible,
  ensurePedTherChemTasksVisible,
} from '@/lib/subjects';
import {
  buildSelectingPreviewUser,
  buildSelectingPreviewUserFromExisting,
  buildActivePreviewUser,
  resumePreviewTrialAfterGroup,
  recordFacultyChoiceOnly,
  isEstablishedAccount,
  userAlreadyHasSubjectAccess,
  getAllPickableSubjectIds,
  getEffectiveUserSubjects,
  abandonPendingPreviewPayment,
  canAbandonPendingPreview,
  canReturnToPurchasedAccess,
  getPreviewPaymentGrantedModules,
  getPaymentGrantedSubjects,
  switchPreviewPaymentSubject,
  maybeExpirePreviewUser,
  applyModuleTrialExpiries,
  previewEndsAt,
  isPreviewTrialLocked,
  isPreviewShortDurationAccount,
  hasFinalizedPreviewAccess,
  healExamNavHidden,
  healStalePreviewForFinalizedUser,
  clearPreviewFlowIfAdminGrantedAccess,
  normalizeAddonPreviewNavHidden,
  userAlreadyHasAllChosenModules,
  claimPreviewReceipt,
  updatePreviewPaymentChoice,
  normalizePreviewModules,
  syncPreviewActiveMs,
  getPreviewActiveMsConsumed,
  getPreviewActiveMsByModule,
  previewRemainingMs,
  previewRemainingMsByModule,
  previewRemainingMinByModule,
} from '@/lib/preview';
import type { PreviewModule } from '@/lib/previewModules';
import { ensureModuleStatusMap } from '@/lib/previewModuleStatus';
import { notifyAdminReceiptClaimed } from '@/lib/notifyAdmin';
import { resolveFacultyPromoCode, facultyFieldsFromUser, resolveUserFacultyPromo, applyFacultyToUser, getFacultyPromoById, userNeedsFacultyPick, userHasKnownFaculty, healUserFacultyFields } from '@/lib/facultyCodes';
import { ACCESS_CACHE_VERSION } from '@/lib/accessCache';
import { normalizeStudyGroup, buildStudyGroupFromDigits } from '@/lib/studyGroup';
import { applyGroupAccessToUser, loadGroupAccessRules, buildGroupAccessClientPayload, dismissGroupAccessHint } from '@/lib/groupAccess';
import { buildSubjectCatalog } from '@/lib/subjectCatalog';
import { buildPreviewSubjectCatalog } from '@/lib/previewCatalogSettings';
import type { FacultyPromo } from '@/lib/facultyCodes';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { registerUserId } from '@/lib/userIndex';
import { clearAuthRateLimitsForTgId, checkCatalogBrowseLimit } from '@/lib/authRateLimit';
import {
  buildCatalogSelectingUser,
  canExitCatalogBrowse,
  exitCatalogBrowse,
  getCatalogGrantedSubjects,
  isCatalogModuleAlreadyGranted,
  restartCatalogBrowseSelecting,
} from '@/lib/catalogBrowse';
import { touchUserActivity, touchUserVisit } from '@/lib/userActivity';
import { isRedisUnavailableError } from '@/lib/redisDegraded';
import { isUserLockTimeout, withUserLock } from '@/lib/userLock';

const redis = createRedisFromEnv();

const BOT_TOKEN        = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'nzsdental';
const TRIAL_DAYS       = Number(process.env.TRIAL_DAYS) || 0;
const ADMIN_TG_ID      = process.env.ADMIN_TG_ID || '';

type Profile = { username: string | null; firstName: string | null; lastName: string | null };

/** Просмотр каталога из статистики: код → группа → витрина → просмотр другого предмета. */
async function handleCatalogBrowseStart(
  res: NextApiResponse,
  tgIdStr: string,
  user: any,
  profile: Profile,
  promo: FacultyPromo,
) {
  const catalog = await buildPreviewSubjectCatalog(redis);
  user = user ? await maybeExpirePreviewUser(redis, tgIdStr, user) : user;

  if (
    user?.previewStatus === 'expired'
    && user.receiptClaimedAt
    && !user.previewConfirmedAt
    && !canAbandonPendingPreview(user)
  ) {
    return res.status(403).json({
      error: 'Ожидайте подтверждения доступа администратором.',
      previewAwaiting: true,
      ...previewPayload(user, catalog, tgIdStr),
    });
  }

  const needsRestart = user?.previewStatus === 'active'
    || user?.previewStatus === 'expired'
    || user?.previewStatus === 'selecting';

  const merged = needsRestart
    ? restartCatalogBrowseSelecting(user, profile, promo)
    : buildCatalogSelectingUser(user, profile, promo);

  await saveUser(tgIdStr, merged);
  await clearAuthRateLimitsForTgId(redis, tgIdStr);
  return res.status(200).json({
    success: true,
    catalogBrowse: true,
    preview: true,
    subjects: [],
    ...previewPayload(merged, catalog, tgIdStr),
  });
}

async function handlePreviewStart(
  res: NextApiResponse,
  tgIdStr: string,
  ip: string,
  user: any,
  profile: { username: string | null; firstName: string | null; lastName: string | null },
  promo?: FacultyPromo,
  catalogBrowse = false,
) {
  const catalog = await buildPreviewSubjectCatalog(redis);

  if (hasFinalizedPreviewAccess(user)) {
    if (promo && catalogBrowse) {
      const merged = buildCatalogSelectingUser(user, profile, promo);
      await saveUser(tgIdStr, merged);
      return res.status(200).json({ success: true, preview: true, ...previewPayload(merged, catalog, tgIdStr) });
    }
    const healed = healStalePreviewForFinalizedUser(user);
    if (healed !== user) await saveUser(tgIdStr, healed);
    return res.status(200).json({
      success: true,
      alreadyConfirmed: true,
      ...(await subjectsResponse(healed, tgIdStr)),
    });
  }

  if (user?.previewStatus === 'expired') {
    if (catalogBrowse && promo) {
      const merged = restartCatalogBrowseSelecting(user, profile, promo);
      await saveUser(tgIdStr, merged);
      await clearAuthRateLimitsForTgId(redis, tgIdStr);
      return res.status(200).json({
        success: true,
        preview: true,
        catalogBrowse: true,
        subjects: [],
        ...previewPayload(merged, catalog, tgIdStr),
      });
    }
    const healedExpired = healStalePreviewForFinalizedUser(user);
    if (healedExpired !== user) {
      await saveUser(tgIdStr, touchUserVisit(healedExpired));
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
        ...(await subjectsResponse(healedExpired, tgIdStr)),
      });
    }
    return res.status(403).json({
      error: 'Ожидайте подтверждения доступа администратором.',
      previewAwaiting: true,
      ...previewPayload(user, catalog, tgIdStr),
    });
  }

  if (user?.previewStatus === 'selecting') {
    if (promo) {
      const merged = catalogBrowse
        ? buildCatalogSelectingUser(user, profile, promo)
        : buildSelectingPreviewUserFromExisting(user, profile, promo, { forceNewGroup: catalogBrowse });
      await saveUser(tgIdStr, merged);
      return res.status(200).json({ success: true, preview: true, ...previewPayload(merged, catalog, tgIdStr) });
    }
    return res.status(200).json({ success: true, resumed: true, ...previewPayload(user, catalog, tgIdStr) });
  }

  if (user?.previewStatus === 'active') {
    user = await maybeExpirePreviewUser(redis, tgIdStr, user);
    if (user.previewStatus === 'expired') {
      return res.status(403).json({
        error: 'Сессия завершена. Ожидайте подтверждения доступа.',
        previewAwaiting: true,
        ...previewPayload(user, catalog, tgIdStr),
      });
    }
    return res.status(200).json({ success: true, resumed: true, ...(await subjectsResponse(user, tgIdStr)) });
  }

  if (isEstablishedAccount(user)) {
    if (!promo) {
      return res.status(400).json({ error: 'Введи код из канала.' });
    }
    if (!catalogBrowse) {
      let refreshed = healStalePreviewForFinalizedUser(user);
      refreshed = {
        ...touchUserVisit(refreshed),
        promoCode:    promo.code,
        facultyId:    promo.id,
        previewFaculty: promo.facultyLabel,
        username:     profile.username ?? refreshed.username,
        firstName:    profile.firstName ?? refreshed.firstName,
        lastName:     profile.lastName ?? refreshed.lastName,
      };
      await saveUser(tgIdStr, refreshed);
      await clearAuthRateLimitsForTgId(redis, tgIdStr);
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
        ...(await subjectsResponse(refreshed, tgIdStr)),
      });
    }
    const merged = buildCatalogSelectingUser(user, profile, promo);
    await saveUser(tgIdStr, merged);
    await clearAuthRateLimitsForTgId(redis, tgIdStr);
    return res.status(200).json({ success: true, preview: true, catalogBrowse: true, subjects: [], ...previewPayload(merged, catalog, tgIdStr) });
  }

  const alreadyUsed = await isPreviewTrialLocked(redis, tgIdStr);
  if (alreadyUsed) {
    return res.status(403).json({ error: 'Код из канала уже использован. Свяжись с администратором.' });
  }

  if (!promo) {
    return res.status(400).json({ error: 'Введи код из канала.' });
  }

  const { blocked } = await checkRateLimit(ip, `demo_${tgIdStr}`);
  if (blocked) return res.status(429).json({ error: 'Слишком много попыток.' });

  const newUser = buildSelectingPreviewUser(profile, promo);
  await saveUser(tgIdStr, newUser);
  await redis.sadd('used_demo_ids', tgIdStr);
  await clearAuthRateLimitsForTgId(redis, tgIdStr);

  return res.status(200).json({ success: true, preview: true, ...previewPayload(newUser, catalog, tgIdStr) });
}

const isValidTelegramId = (id: string): boolean => {
  if (!/^\d{5,12}$/.test(id)) return false;
  const n = Number(id);
  return n >= 10000 && n <= 9_999_999_999;
};

const isValidKeyFormat = (key: string): boolean => {
  const k = key.trim();
  if (!/^\d{8}$/.test(k)) return false;
  const d = k.split('').map(Number);
  const sumCheck = d[0] + d[1] + d[7] === 15;
  const modCheck = parseInt(k, 10) % 7 === 3;
  return sumCheck && modCheck;
};

async function isSubscribed(userId: number): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const url  = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${CHANNEL_USERNAME}&user_id=${userId}`;
    // Таймаут обязателен: проверка идёт под блокировкой пользователя, а
    // зависший api.telegram.org держал бы вход до бесконечности.
    const res  = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[isSubscribed] getChatMember failed for ${userId}:`, JSON.stringify(data));
      return false;
    }
    return ['member', 'administrator', 'creator'].includes(data.result.status);
  } catch (e) {
    console.error(`[isSubscribed] fetch error for ${userId}:`, e);
    return false;
  }
}

const MAX_ATTEMPTS      = 3;
const BASE_BLOCK_SEC    = 2  * 60 * 60;
const EXTRA_BLOCK_SEC   = 10 * 60 * 60;

async function checkRateLimit(ip: string, tgId: string) {
  const rateKey  = `rate:${ip}:${tgId}`;
  const blockKey = `block:${ip}:${tgId}`;
  const violKey  = `viol:${ip}:${tgId}`;

  const blocked = await redis.exists(blockKey);
  if (blocked) {
    const viols = await redis.incr(violKey);
    const newBlock = BASE_BLOCK_SEC + (viols - 1) * EXTRA_BLOCK_SEC;
    await redis.set(blockKey, viols, { ex: newBlock });
    return { blocked: true };
  }

  const attempts = await redis.incr(rateKey);
  if (attempts === 1) await redis.expire(rateKey, 3600);

  if (attempts >= MAX_ATTEMPTS) {
    const viols = await redis.incr(violKey);
    await redis.expire(violKey, 30 * 24 * 3600);
    const blockSec = BASE_BLOCK_SEC + (viols - 1) * EXTRA_BLOCK_SEC;
    await redis.set(blockKey, viols, { ex: blockSec });
    await redis.del(rateKey);
    return { blocked: true };
  }
  return { blocked: false };
}

async function resetRateLimit(ip: string, tgId: string) {
  await redis.del(`rate:${ip}:${tgId}`);
  await redis.del(`block:${ip}:${tgId}`);
}

function getIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

function ensureSubjectsField(user: any): any {
  return migrateUserSubjects(user);
}

function previewPayload(
  user: any,
  catalog?: ReturnType<typeof buildSubjectCatalog>,
  tgId?: string,
) {
  const selecting = user?.previewStatus === 'selecting';
  const hasGroup  = !!String(user?.studyGroup || '').trim();
  const navHidden = (user?.navHidden && typeof user.navHidden === 'object')
    ? user.navHidden as Record<string, string[]>
    : {};
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const moduleStatuses = ensureModuleStatusMap(user);
  const hasTrialModule = chosen.some(m => moduleStatuses[m] === 'trial');
  return {
    previewStatus:        user?.previewStatus ?? null,
    previewChosenSubject: user?.previewChosenSubject ?? null,
    previewChosenModules: user?.previewChosenModules ?? null,
    previewPaymentSelection: user?.previewPaymentSelection ?? null,
    studyGroup:           user?.studyGroup ?? null,
    needsStudyGroup:      selecting && userHasKnownFaculty(user) && !hasGroup,
    previewEndsAt:        previewEndsAt(user, tgId),
    previewStartedAt:     (user?.previewStatus === 'active' || hasTrialModule)
      ? (user.previewStartedAt ?? null)
      : null,
    previewConfirmedAt:   user?.previewConfirmedAt ?? null,
    previewQuotedPrice:   user?.previewQuotedPrice ?? null,
    receiptClaimedAt:     user?.receiptClaimedAt ?? null,
    pickSubjects:         selecting ? getAllPickableSubjectIds() : undefined,
    subjectCatalog:       selecting && catalog ? catalog : undefined,
    navHidden,
    catalogBrowseActive: user?._catalogBrowse === true,
    catalogGrantedSubjects: user?._catalogBrowse
      ? getCatalogGrantedSubjects(user)
      : undefined,
    canExitCatalogBrowse: canExitCatalogBrowse(user),
    needsFacultyPick: userNeedsFacultyPick(user),
    canReturnToPurchasedAccess: canReturnToPurchasedAccess(user),
    canAbandonPendingPreview: canAbandonPendingPreview(user),
    previewGrantedModules: getPreviewPaymentGrantedModules(user),
    paymentGrantedSubjects: getPaymentGrantedSubjects(user),
    previewModuleStatuses: ensureModuleStatusMap(user),
    previewActiveMsConsumed: getPreviewActiveMsConsumed(user),
    previewActiveMsByModule: getPreviewActiveMsByModule(user),
    previewRemainingMs: previewRemainingMs(user, tgId),
    previewRemainingMsByModule: previewRemainingMsByModule(user, tgId),
    previewRemainingMinByModule: previewRemainingMinByModule(user, tgId),
    previewModuleTrustExpiresAt: user?.previewModuleTrustExpiresAt ?? undefined,
    ...facultyFieldsFromUser(user),
  };
}

async function saveUser(tgId: string, user: any) {
  const { user: healed } = healUserFacultyFields(user);
  await redis.set(`user_id:${tgId}`, healed);
  await registerUserId(redis, tgId);
}


async function mergeGroupAccess(user: any): Promise<{ user: any; changed: boolean }> {
  try {
    const rules = await loadGroupAccessRules(redis);
    return applyGroupAccessToUser(user, rules);
  } catch (e) {
    console.error('[mergeGroupAccess]', e);
    return { user, changed: false };
  }
}

async function subjectsResponse(user: any, tgId?: string, extra?: Record<string, unknown>) {
  user = migrateUserSubjects(user);
  user = normalizeAddonPreviewNavHidden(user);
  user = healUserFacultyFields(user).user;
  if (tgId) {
    const merged = await mergeGroupAccess(user);
    user = merged.user;
    if (merged.changed) {
      await saveUser(tgId, touchUserActivity(user));
    }
  }
  const stomTasks = ensureStomatologyBioTasksVisible(user);
  if (stomTasks) user = stomTasks;
  const pedBioTasks = ensurePedTherBioTasksVisible(user);
  if (pedBioTasks) user = pedBioTasks;
  const chemTasks = ensurePedTherChemTasksVisible(user);
  if (chemTasks) user = chemTasks;
  const subjects = getEffectiveUserSubjects(user, tgId);
  const catalog = user?.previewStatus ? await buildPreviewSubjectCatalog(redis) : undefined;
  return {
    registered: true,
    subjects,
    accessCacheVersion: ACCESS_CACHE_VERSION,
    ...previewPayload(user, catalog, tgId),
    ...buildGroupAccessClientPayload(user),
    ...extra,
  };
}

async function healAndMaybePersistUser(tgId: string, user: any, redisOk: boolean): Promise<{ user: any; accessHealed: boolean }> {
  const before = user;
  let healed = healStalePreviewForFinalizedUser(user);
  healed = normalizeAddonPreviewNavHidden(healed);
  healed = healExamNavHidden(healed);
  healed = clearPreviewFlowIfAdminGrantedAccess(healed);
  const facultyHeal = healUserFacultyFields(healed);
  healed = facultyHeal.user;
  const stomTasks = ensureStomatologyBioTasksVisible(healed);
  if (stomTasks) healed = stomTasks;
  const pedBioTasks = ensurePedTherBioTasksVisible(healed);
  if (pedBioTasks) healed = pedBioTasks;
  const chemTasks = ensurePedTherChemTasksVisible(healed);
  if (chemTasks) healed = chemTasks;
  const resumed = resumePreviewTrialAfterGroup(healed);
  if (resumed) healed = resumed;
  const merged = await mergeGroupAccess(healed);
  healed = merged.user;
  const accessHealed = healed !== before || facultyHeal.changed || merged.changed;
  if (redisOk && accessHealed) {
    await saveUser(tgId, touchUserActivity(healed));
  }
  return { user: healed, accessHealed };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    key, telegramId, mode, initData, subjectId, course, faculty, modules,
    studyGroup: studyGroupRaw, catalogBrowse,
  } = req.body;
  const isCatalogBrowse = catalogBrowse === true || catalogBrowse === 'true';

  const tgIdStr = String(telegramId || '').trim();
  if (!isValidTelegramId(tgIdStr)) {
    return res.status(400).json({ error: 'Некорректный Telegram ID.' });
  }

  let username: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let skipSubscriptionCheck = false;

  if (initData) {
    const tgUser = verifyInitDataUser(initData, BOT_TOKEN || '');
    if (!tgUser || String(tgUser.id) !== tgIdStr) {
      return res.status(401).json({ error: 'Ошибка верификации данных.' });
    }
    username = tgUser.username || null;
    firstName = tgUser.first_name || null;
    lastName = tgUser.last_name || null;
  } else {
    // Без initData — только веб-сессия (cookie) с привязанным Telegram.
    // Whitelist и тестовый аккаунт здесь не годятся: Telegram ID не секрет,
    // и по одному ID кто угодно входил бы от имени этого пользователя.
    // Whitelist снимает только проверку подписки на канал (ниже).
    const { resolveRequestIdentity } = await import('@/lib/resolveIdentity');
    const identity = await resolveRequestIdentity(redis, req, {
      telegramId: tgIdStr,
      initData: '',
      requireTelegram: true,
    });
    if (!(identity.ok && identity.via === 'session' && identity.tgId === tgIdStr)) {
      return res.status(403).json({
        error: 'Открой через бота или войди на сайте и привяжи Telegram.',
        noInitData: true,
      });
    }
  }

  // Всё чтение-запись пользователя дальше — под блокировкой (src/lib/userLock.ts):
  // иначе параллельный запрос мог затереть подтверждение оплаты админом.
  try {
    return await withUserLock(redis, tgIdStr, async () => {
      const ip = getIp(req);

      let redisOk = true;
      try {
        let user: any = null;
        try {
          user = await redis.get(`user_id:${tgIdStr}`);
        } catch (err) {
          redisOk = false;
          if (!isRedisUnavailableError(err)) throw err;
          if (mode === 'check_subjects') {
            return res.status(200).json({ degraded: true, registered: true });
          }
        }
        if (typeof user === 'string') {
          try { user = JSON.parse(user); } catch { user = null; }
        }
        user = ensureSubjectsField(user);

        const isOwner = ADMIN_TG_ID && tgIdStr === ADMIN_TG_ID;
        if (!isOwner && user?.blocked === true) {
          return res.status(403).json({ error: 'Твой аккаунт заблокирован. Свяжись с администратором.', blocked: true });
        }

        if (isOwner || isPreviewShortDurationAccount(tgIdStr)) {
          skipSubscriptionCheck = true;
        }

        if (!skipSubscriptionCheck) {
          const inWhitelist = await redis.sismember('sub_whitelist', tgIdStr);
          if (!inWhitelist) {
            const subscribed = await isSubscribed(Number(tgIdStr));
            if (!subscribed) {
              return res.status(403).json({
                error: `Подпишись на @${CHANNEL_USERNAME} для доступа.`,
                needSubscription: true,
              });
            }
          }
        }

        if (mode === 'check_demo') {
          return res.status(400).json({ error: 'Введи код из канала в поле выше.' });
        }

        if (mode === 'start_catalog_browse') {
          if (!user) {
            return res.status(401).json({ error: 'Сначала войди в приложение.' });
          }
          if (!isEstablishedAccount(user)) {
            return res.status(403).json({ error: 'Каталог доступен после регистрации.' });
          }
          let promo = resolveUserFacultyPromo(user, key, req.body?.facultyId);
          if (!promo) {
            return res.status(400).json({
              error: 'Введи код факультета из канала.',
              needsFacultyCode: true,
            });
          }
          const catalogLimit = await checkCatalogBrowseLimit(redis, ip, tgIdStr, 'success');
          if (catalogLimit.blocked) {
            return res.status(429).json({ error: 'Доступ временно заблокирован. Подожди 30 минут.' });
          }
          const profile = { username, firstName, lastName };
          return handleCatalogBrowseStart(res, tgIdStr, user, profile, promo);
        }

        if (mode === 'exit_catalog_browse') {
          if (!canExitCatalogBrowse(user)) {
            return res.status(400).json({ error: 'Нельзя вернуться к купленному сейчас.' });
          }
          const updated = exitCatalogBrowse(user);
          if (!updated) {
            return res.status(400).json({ error: 'Не удалось вернуться к купленному.' });
          }
          updated.username   = username ?? updated.username;
          updated.firstName  = firstName ?? updated.firstName;
          updated.lastName   = lastName ?? updated.lastName;
          updated.lastLogin  = new Date().toISOString();
          updated.loginCount = Number(updated.loginCount || 0) + 1;
          await saveUser(tgIdStr, updated);
          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(updated, tgIdStr)),
          });
        }

        if (mode === 'set_faculty') {
          if (!user) {
            return res.status(401).json({ error: 'Сначала войди в приложение.' });
          }
          const facultyId = String(req.body?.facultyId || '').trim();
          const promo = getFacultyPromoById(facultyId);
          if (!promo) {
            return res.status(400).json({ error: 'Неизвестный факультет.' });
          }
          let updated = applyFacultyToUser(
            touchUserVisit({ ...user, username, firstName, lastName }),
            promo,
          );
          const withBioTasks = ensureStomatologyBioTasksVisible(updated);
          if (withBioTasks) updated = withBioTasks;
          const withPedBioTasks = ensurePedTherBioTasksVisible(updated);
          if (withPedBioTasks) updated = withPedBioTasks;
          const withChemTasks = ensurePedTherChemTasksVisible(updated);
          if (withChemTasks) updated = withChemTasks;
          await saveUser(tgIdStr, updated);
          return res.status(200).json(await subjectsResponse(updated, tgIdStr));
        }

        if (mode === 'set_study_group') {
          const canSetGroup = user && (
            user.previewStatus === 'selecting'
            || user.previewStatus === 'active'
            || user.previewStatus === 'expired'
          );
          if (!canSetGroup) {
            return res.status(400).json({ error: 'Сейчас нельзя сохранить группу.' });
          }
          const facultyId = String(user.facultyId || '').trim() || null;
          const built = buildStudyGroupFromDigits(String(studyGroupRaw ?? ''), facultyId);
          if (!built) {
            return res.status(400).json({
              error: facultyId
                ? 'Введи номер группы цифрами, например 108'
                : 'Сначала введи код доступа.',
            });
          }
          const updated = {
            ...user,
            studyGroup: normalizeStudyGroup(built),
            username:   username ?? user.username,
            firstName:  firstName ?? user.firstName,
            lastName:   lastName ?? user.lastName,
            lastLogin:  new Date().toISOString(),
            loginCount: Number(user.loginCount || 0) + 1,
          };
          const resumed = resumePreviewTrialAfterGroup(updated) ?? updated;
          const merged = await mergeGroupAccess(resumed);
          const withGroup = merged.user;
          await saveUser(tgIdStr, touchUserActivity(withGroup));
          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(withGroup, tgIdStr)),
          });
        }

        if (mode === 'dismiss_group_access_hint') {
          if (!user) return res.status(404).json({ error: 'User not found' });
          const dismissed = dismissGroupAccessHint(user);
          if (dismissed.changed) {
            await saveUser(tgIdStr, touchUserActivity(dismissed.user));
          }
          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(dismissed.user, tgIdStr)),
          });
        }

        if (mode === 'pick_preview_subject') {
          if (!user || user.previewStatus !== 'selecting') {
            return res.status(400).json({ error: 'Выбор предмета недоступен.' });
          }
          if (!String(user.studyGroup || '').trim()) {
            return res.status(400).json({
              error: 'Сначала укажи номер группы.',
              needsStudyGroup: true,
            });
          }

          const chosen = String(subjectId || '').trim();
          const lockedSubject = String(user.previewChosenSubject || '').trim();
          if (lockedSubject && lockedSubject !== chosen) {
            return res.status(400).json({ error: 'Предмет уже выбран и изменить его нельзя.' });
          }
          const subjectToUse = lockedSubject || chosen;

          if (!getSubject(subjectToUse)) {
            return res.status(400).json({ error: 'Неизвестный предмет.' });
          }

          const catalogEntry = (await buildPreviewSubjectCatalog(redis)).find(s => s.id === subjectToUse);
          if (!catalogEntry?.hasAnyModule) {
            return res.status(400).json({ error: 'Для этого предмета материалы ещё не готовы.' });
          }

          const chosenModules = normalizePreviewModules(modules);
          if (chosenModules.length === 0) {
            return res.status(400).json({ error: 'Выбери хотя бы один раздел.' });
          }
          for (const modId of chosenModules) {
            const mod = catalogEntry.modules.find(m => m.id === modId);
            if (!mod?.available) {
              return res.status(400).json({ error: 'Один из разделов недоступен.' });
            }
          }

          if (user._catalogBrowse) {
            const granted = getCatalogGrantedSubjects(user);
            const navHiddenMap = (user.navHidden && typeof user.navHidden === 'object')
              ? user.navHidden as Record<string, string[]>
              : {};
            for (const modId of chosenModules) {
              if (isCatalogModuleAlreadyGranted(subjectToUse, modId, granted, navHiddenMap)) {
                return res.status(400).json({
                  error: 'Этот раздел уже открыт. Выбери другой для докупки.',
                });
              }
            }
          } else if (
            !isPreviewShortDurationAccount(tgIdStr)
            && userAlreadyHasAllChosenModules(user, subjectToUse, chosenModules)
          ) {
            const updated = recordFacultyChoiceOnly(user, subjectToUse, chosenModules);
            updated.username   = username ?? updated.username;
            updated.firstName  = firstName ?? updated.firstName;
            updated.lastName   = lastName ?? updated.lastName;
            updated.lastLogin  = new Date().toISOString();
            updated.loginCount = Number(updated.loginCount || 0) + 1;
            await saveUser(tgIdStr, updated);
            return res.status(200).json({
              success: true,
              facultyRecorded: true,
              ...(await subjectsResponse(updated, tgIdStr)),
            });
          }

          const isCatalogAddon = user._catalogBrowse === true
            && userAlreadyHasSubjectAccess(user, subjectToUse);
          const updated = buildActivePreviewUser(user, subjectToUse, chosenModules, {
            catalogAddon: isCatalogAddon,
          });
          if (user._catalogBrowse) {
            updated._catalogBrowse = true;
          }
          updated.username   = username ?? updated.username;
          updated.firstName  = firstName ?? updated.firstName;
          updated.lastName   = lastName ?? updated.lastName;
          updated.lastLogin  = new Date().toISOString();
          updated.loginCount = Number(updated.loginCount || 0) + 1;

          await saveUser(tgIdStr, updated);

          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(updated, tgIdStr)),
          });
        }

        if (mode === 'sync_preview_active') {
          if (!user) {
            return res.status(200).json({ success: true, ...(await subjectsResponse(user, tgIdStr)) });
          }
          const deltaMs = Number(req.body?.deltaMs);
          const moduleRaw = String(req.body?.module || '').trim();
          const activeModule = (['questions', 'tests', 'tasks'] as PreviewModule[]).includes(moduleRaw as PreviewModule)
            ? moduleRaw as PreviewModule
            : null;
          let updated = syncPreviewActiveMs(user, activeModule, deltaMs, tgIdStr);
          if (updated !== user) {
            await saveUser(tgIdStr, updated);
          }
          updated = await maybeExpirePreviewUser(redis, tgIdStr, updated);
          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(updated, tgIdStr)),
          });
        }

        if (mode === 'abandon_pending_preview') {
          if (!user?.previewChosenSubject) {
            return res.status(400).json({ error: 'Нет незавершённой заявки.' });
          }
          if (user.receiptClaimedAt) {
            return res.status(400).json({ error: 'После отправки чека отменить нельзя.' });
          }
          user = await maybeExpirePreviewUser(redis, tgIdStr, user);
          if (!canAbandonPendingPreview(user)) {
            return res.status(400).json({ error: 'Нет открытых предметов для возврата.' });
          }
          const updated = abandonPendingPreviewPayment(user);
          if (!updated) {
            return res.status(400).json({ error: 'Не удалось отменить заявку.' });
          }
          updated.username   = username ?? updated.username;
          updated.firstName  = firstName ?? updated.firstName;
          updated.lastName   = lastName ?? updated.lastName;
          updated.lastLogin  = new Date().toISOString();
          updated.loginCount = Number(updated.loginCount || 0) + 1;
          await saveUser(tgIdStr, updated);
          return res.status(200).json({
            success: true,
            abandonedPreview: true,
            ...(await subjectsResponse(updated, tgIdStr)),
          });
        }

        if (mode === 'update_preview_payment_subject') {
          if (!user?.previewChosenSubject) {
            return res.status(400).json({ error: 'Заявка не найдена.' });
          }
          if (user.receiptClaimedAt) {
            return res.status(400).json({ error: 'После отправки чека предмет изменить нельзя.' });
          }
          const nextSubject = String(subjectId || '').trim();
          if (!getSubject(nextSubject)) {
            return res.status(400).json({ error: 'Неизвестный предмет.' });
          }
          user = await maybeExpirePreviewUser(redis, tgIdStr, user);
          const moduleList = normalizePreviewModules(modules);
          const switched = switchPreviewPaymentSubject(
            user,
            nextSubject,
            moduleList.length > 0 ? moduleList : undefined,
          );
          if (!switched) {
            return res.status(400).json({ error: 'Для этого предмета нечего докупить.' });
          }
          const healedSwitch = applyModuleTrialExpiries(switched, tgIdStr) ?? switched;
          await saveUser(tgIdStr, touchUserActivity(healedSwitch));
          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(healedSwitch, tgIdStr)),
          });
        }

        if (mode === 'update_preview_payment_choice') {
          if (!user?.previewChosenSubject) {
            return res.status(400).json({ error: 'Заявка не найдена.' });
          }
          if (user.receiptClaimedAt) {
            return res.status(400).json({ error: 'После отправки чека выбор изменить нельзя.' });
          }
          user = await maybeExpirePreviewUser(redis, tgIdStr, user);
          let updated = updatePreviewPaymentChoice(user, normalizePreviewModules(modules));
          if (!updated) {
            return res.status(400).json({ error: 'Выбери хотя бы один раздел.' });
          }
          updated = applyModuleTrialExpiries(updated, tgIdStr) ?? updated;
          await saveUser(tgIdStr, touchUserActivity(updated));
          return res.status(200).json({
            success: true,
            ...(await subjectsResponse(updated, tgIdStr)),
          });
        }

        if (mode === 'claim_preview_receipt') {
          if (!user?.previewChosenSubject) {
            return res.status(400).json({ error: 'Заявка не найдена.' });
          }
          if (!String(user.studyGroup || '').trim()) {
            return res.status(400).json({
              error: 'Укажи номер группы перед отправкой чека.',
              needsStudyGroup: true,
            });
          }
          user = await maybeExpirePreviewUser(redis, tgIdStr, user);
          const claimModules = normalizePreviewModules(modules);
          const updated = claimPreviewReceipt(user, claimModules.length > 0 ? claimModules : undefined);
          if (!updated) return res.status(400).json({ error: 'Не удалось сохранить.' });
          await saveUser(tgIdStr, touchUserActivity(updated));
          const notifiedModules = claimModules.length > 0
            ? claimModules
            : (['questions', 'tests', 'tasks'] as const).filter(
                m => updated.previewModuleStatuses?.[m] === 'receipt_pending',
              );
          void notifyAdminReceiptClaimed({
            tgId:       tgIdStr,
            firstName,
            lastName,
            username,
            subjectId:  String(updated.previewChosenSubject),
            modules:    notifiedModules,
          });
          return res.status(200).json({
            success: true,
            receiptClaimed: true,
            awaitingAdmin: true,
            accessGranted: hasFinalizedPreviewAccess(updated)
              || updated.subjects?.[updated.previewChosenSubject] === true,
            ...(await subjectsResponse(updated, tgIdStr)),
          });
        }

        if (mode === 'check_preview_status') {
          if (!user?.previewStatus && !hasFinalizedPreviewAccess(user) && !user?.receiptClaimedAt) {
            return res.status(404).json({ error: 'Заявка не найдена.' });
          }
          user = await maybeExpirePreviewUser(redis, tgIdStr, user);
          const healedPreview = await healAndMaybePersistUser(tgIdStr, user, redisOk);
          user = healedPreview.user;
          const catalog = await buildPreviewSubjectCatalog(redis);
          if (hasFinalizedPreviewAccess(user)) {
            return res.status(200).json({
              success: true,
              ...(await subjectsResponse(user, tgIdStr, { accessHealed: healedPreview.accessHealed })),
            });
          }
          if (user.receiptClaimedAt) {
            return res.status(200).json({
              success: true,
              awaitingAdmin: true,
              receiptClaimed: true,
              ...previewPayload(user, catalog, tgIdStr),
            });
          }
          if (user.previewStatus === 'expired') {
            return res.status(200).json({ success: true, awaitingAdmin: true, ...previewPayload(user, catalog, tgIdStr) });
          }
          if (user.previewStatus === 'selecting') {
            return res.status(200).json({ success: true, needsSubjectPick: true, ...previewPayload(user, catalog, tgIdStr) });
          }
          if (user.previewStatus === 'active') {
            return res.status(200).json({
              success: true,
              ...(await subjectsResponse(user, tgIdStr)),
            });
          }
          return res.status(404).json({ error: 'Статус не определён.' });
        }

        if (mode === 'check_micro') {
          const userSubjects = getEffectiveUserSubjects(user, tgIdStr);
          return res.status(200).json({ hasMicro: userSubjects.includes('micro') });
        }

        if (mode === 'check_subjects') {
          if (!user) {
            if (!redisOk) {
              return res.status(200).json({ degraded: true, registered: true });
            }
            return res.status(200).json({ subjects: [], navHidden: {}, registered: false });
          }

          if (redisOk) {
            user = await maybeExpirePreviewUser(redis, tgIdStr, user);
          }
          const healedCheck = await healAndMaybePersistUser(tgIdStr, user, redisOk);

          return res.status(200).json(await subjectsResponse(
            healedCheck.user,
            tgIdStr,
            { accessHealed: healedCheck.accessHealed },
          ));
        }

        if (user && !user.trial_until && !user.previewStatus) {
          await redis.set(`user_id:${tgIdStr}`, {
            ...user,
            username,
            firstName,
            lastName,
            _migrated_subjects: true,
            lastLogin:  new Date().toISOString(),
            loginCount: ((user as any).loginCount || 0) + 1,
          });
          await registerUserId(redis, tgIdStr);
          await resetRateLimit(ip, tgIdStr);

          const userSubjects = getUserAvailableSubjects(user);
          return res.status(200).json({
            success:  true,
            subjects: userSubjects,
            hasMicro: userSubjects.includes('micro'),
          });
        }

        if (TRIAL_DAYS > 0) {
          const now = new Date();
          if (!user && !key) {
            const trialUntil = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
            const newUser = {
              activatedKey: 'trial',
              date:         now.toISOString(),
              trial_until:  trialUntil.toISOString(),
              username, firstName, lastName,
              subjects:     createDefaultSubjects(),
              _migrated_subjects: true,
            };
            await redis.set(`user_id:${tgIdStr}`, newUser);
            await registerUserId(redis, tgIdStr);

            const userSubjects = getUserAvailableSubjects(newUser);
            return res.status(200).json({
              success:  true,
              trial:    true,
              trialUntil,
              subjects: userSubjects,
              hasMicro: false,
            });
          }
          if (user?.trial_until) {
            const trialEnd = new Date(user.trial_until);
            if (now < trialEnd) {
              if (username !== user.username) {
                await redis.set(`user_id:${tgIdStr}`, { ...user, username, firstName, lastName });
                await registerUserId(redis, tgIdStr);
              }
              const userSubjects = getUserAvailableSubjects(user);
              return res.status(200).json({
                success:  true,
                trial:    true,
                trialUntil: trialEnd,
                subjects: userSubjects,
                hasMicro: userSubjects.includes('micro'),
              });
            }
            if (!key) return res.status(401).json({ error: 'Пробный период истёк. Введи ключ.' });
          }
        }

        if (!key) return res.status(401).json({ error: 'Введи код из канала или ключ доступа.' });

        const promo = resolveFacultyPromoCode(String(key).trim());

        if (isCatalogBrowse) {
          if (promo) {
            const catalogLimit = await checkCatalogBrowseLimit(redis, ip, tgIdStr, 'success');
            if (catalogLimit.blocked) {
              return res.status(429).json({ error: 'Доступ временно заблокирован. Подожди 30 минут.' });
            }
            const profile = { username, firstName, lastName };
            if (user && isEstablishedAccount(user)) {
              return handleCatalogBrowseStart(res, tgIdStr, user, profile, promo);
            }
            if (!user) {
              return res.status(401).json({ error: 'Сначала войди в приложение.' });
            }
            return handlePreviewStart(res, tgIdStr, ip, user, profile, promo, true);
          }
          const catalogLimit = await checkCatalogBrowseLimit(redis, ip, tgIdStr, 'fail');
          if (catalogLimit.blocked) {
            return res.status(429).json({ error: 'Доступ временно заблокирован.' });
          }
          return res.status(401).json({ error: 'Неверный код' });
        }

        if (promo) {
          await clearAuthRateLimitsForTgId(redis, tgIdStr);
          return handlePreviewStart(res, tgIdStr, ip, user, { username, firstName, lastName }, promo, isCatalogBrowse);
        }

        const { blocked } = await checkRateLimit(ip, tgIdStr);
        if (blocked) return res.status(429).json({ error: 'Доступ временно заблокирован.' });

        if (!isValidKeyFormat(key)) return res.status(401).json({ error: 'Неверный код или ключ.' });

        const paidKeysEnabled = await redis.get('settings:is_paid_keys_enabled');
        if (paidKeysEnabled === false) {
          return res.status(401).json({ error: 'Платные ключи временно отключены. Введи код из канала.' });
        }

        // SREM атомарен: ключ «забирает» только тот запрос, который его удалил.
        // Раньше sismember + отдельный srem давали двум параллельным запросам
        // активировать один ключ на два аккаунта.
        const claimed = await redis.srem('valid_keys', key.trim());
        if (!claimed) return res.status(401).json({ error: 'Неверный ключ.' });

        const existingSubjects = user?.subjects && typeof user.subjects === 'object'
          ? user.subjects
          : createDefaultSubjects();

        const activatedUser = {
          ...(user || {}),
          activatedKey:       key.trim(),
          date:               user?.date ?? new Date().toISOString(),
          username, firstName, lastName,
          subjects:           existingSubjects,
          previewStatus:      null,
          previewChosenSubject:  null,
          previewChosenModules:  null,
          previewStartedAt:      null,
          previewExpiredAt:      null,
          _subjectsBeforePreview:     undefined,
          _previewStatusBeforeCatalog: undefined,
          _migrated_subjects: true,
        };

        await redis.set(`user_id:${tgIdStr}`, touchUserActivity(activatedUser));
        await registerUserId(redis, tgIdStr);
        await clearAuthRateLimitsForTgId(redis, tgIdStr);

        const userSubjects = getUserAvailableSubjects(activatedUser);
        return res.status(200).json({
          success:  true,
          subjects: userSubjects,
          hasMicro: userSubjects.includes('micro'),
        });

      } catch (error) {
        console.error('API Error:', error);
        if (mode === 'check_subjects' && isRedisUnavailableError(error)) {
          return res.status(200).json({ degraded: true, registered: true });
        }
        const msg = String(error instanceof Error ? error.message : error);
        if (msg.includes('Redis env missing')) {
          return res.status(503).json({
            error: 'Сервер без Redis: задай KV_REST_API_URL/TOKEN или UPSTASH_REDIS_REST_URL/TOKEN.',
          });
        }
        return res.status(500).json({ error: 'Ошибка сервера.' });
      }
    });
  } catch (error) {
    if (isUserLockTimeout(error)) {
      console.warn('[auth] user lock timeout', tgIdStr, mode);
      if (mode === 'check_subjects') {
        return res.status(200).json({ degraded: true, registered: true });
      }
      return res.status(503).json({ error: 'Сервер занят — попробуй ещё раз через пару секунд.' });
    }
    throw error;
  }
}
