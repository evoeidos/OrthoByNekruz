import { SUBJECTS, createDefaultSubjects, getUserAvailableSubjects, getSubject } from '@/lib/subjects';
import {
  clearPreviewFlowFields,
  hasFinalizedPreviewAccess,
  isPreviewFlowInProgress,
} from '@/lib/previewStateMachine';
import type { FacultyPromo } from '@/lib/facultyCodes';
import { applyFacultyToUser, resolveUserFacultyPromo } from '@/lib/facultyCodes';
import { getNavHiddenForSubject } from '@/lib/subjectCatalog';
import {
  type PreviewModule,
  normalizePreviewModules,
} from '@/lib/previewModules';
import {
  buildNavHiddenForCatalogAddonPreview,
  getCatalogGrantedSubjects,
  getGrantedCatalogModules,
  mergeGrantedModulesOnConfirm,
} from '@/lib/catalogBrowse';
import { bioUserHadTest, calcPreviewPriceRub, getPaymentModuleRow } from '@/lib/previewPricing';
import {
  type PreviewModuleStatus,
  type PreviewModuleStatusMap,
  allModulesConfirmed,
  ensureModuleStatusMap,
  initModuleStatuses,
  modulesAwaitingPayment,
  setAllModuleStatuses,
  syncModuleStatusesOnPick,
  isReceiptPendingWithoutTrust,
} from '@/lib/previewModuleStatus';

export type { PreviewModule } from '@/lib/previewModules';
export { PREVIEW_MODULE_LABELS, formatPreviewModulesList, normalizePreviewModules } from '@/lib/previewModules';

/** Скрыть всё, что пользователь не выбрал + exam/materials + нет JSON (проба / экран оплаты). */
export function buildNavHiddenForPreview(
  subjectId: string,
  chosenModules: PreviewModule[],
): string[] {
  const hidden = new Set<string>(['materials']);
  for (const tab of ['questions', 'tests', 'tasks'] as PreviewModule[]) {
    if (!chosenModules.includes(tab)) hidden.add(tab);
  }
  for (const tab of getNavHiddenForSubject(subjectId)) {
    hidden.add(tab);
  }
  return [...hidden];
}

/** После пробы / при частичной оплате — все выбранные разделы в навигации (оплата внутри вкладки). */
export function buildNavHiddenForPaymentTabs(
  subjectId: string,
  chosenModules: PreviewModule[],
  confirmedModules: PreviewModule[] = [],
): string[] {
  const hidden = new Set<string>(['materials']);
  for (const tab of ['questions', 'tests', 'tasks'] as PreviewModule[]) {
    if (!chosenModules.includes(tab)) hidden.add(tab);
  }
  for (const tab of getNavHiddenForSubject(subjectId)) {
    if (!chosenModules.includes(tab as PreviewModule)) hidden.add(tab);
  }
  void confirmedModules;
  return [...hidden];
}

/** После оплаты — открыть купленные разделы и полезные материалы. */
export function buildNavHiddenForConfirmedPurchase(
  subjectId: string,
  chosenModules: PreviewModule[],
): string[] {
  const hidden = new Set<string>();
  for (const tab of ['questions', 'tests', 'tasks'] as PreviewModule[]) {
    if (!chosenModules.includes(tab)) hidden.add(tab);
  }
  for (const tab of getNavHiddenForSubject(subjectId)) {
    hidden.add(tab);
  }
  return [...hidden];
}

/** Максимум реального времени на всю сессию пробника (страховка от «вечного» пробника). */
export const PREVIEW_SESSION_ABSOLUTE_MAX_MS = 20 * 60 * 1000;

export function getPreviewSessionAgeMs(user: any, nowMs = Date.now()): number {
  const started = user?.previewStartedAt ? Date.parse(user.previewStartedAt) : NaN;
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, nowMs - started);
}

export const PREVIEW_DURATION_MS = 5 * 60 * 1000;

/** Проба раздела «Тест» в навигации — 3 мин активного времени на вкладке. */
export const PREVIEW_TESTS_DURATION_MS = 3 * 60 * 1000;

/** Интервал синхронизации таймера пробы с API (каждый раздел — своё значение). */
export const PREVIEW_SYNC_INTERVAL_MS = 60_000;

/** Доступ после «Скинул — войти» без подтверждения админа (trust-window). */
export const PREVIEW_RECEIPT_TRUST_MS = 60 * 60 * 1000;

/** TG ID тестового аккаунта: любая проба истекает через 30 сек реального времени. */
const PREVIEW_TEST_TIME_TG_IDS = new Set(['978243325']);

/** Реальное «стенное» окно пробы для тестового TG. */
export const PREVIEW_TEST_REAL_WINDOW_MS = 30_000;

export function isPreviewShortDurationAccount(tgId?: string | null): boolean {
  return !!tgId && PREVIEW_TEST_TIME_TG_IDS.has(String(tgId).trim());
}

/** Виртуальная длительность пробы одного раздела (тесты — 3 мин, остальное — 5 мин). */
export function getPreviewDurationMs(
  _tgId?: string | null,
  module?: PreviewModule | null,
): number {
  if (module === 'tests') return PREVIEW_TESTS_DURATION_MS;
  return PREVIEW_DURATION_MS;
}

/** Реальное «стенное» окно пробы: как виртуальная длительность; для тестового TG — 30 сек. */
export function getPreviewRealWindowMs(
  tgId?: string | null,
  module?: PreviewModule | null,
): number {
  if (isPreviewShortDurationAccount(tgId)) return PREVIEW_TEST_REAL_WINDOW_MS;
  return getPreviewDurationMs(tgId, module);
}

/** 1 для обычных; для тестового TG — ускорение так, чтобы лимит раздела наступил за 30 сек. */
export function getPreviewActiveTimeMultiplier(
  tgId?: string | null,
  module?: PreviewModule | null,
): number {
  if (!isPreviewShortDurationAccount(tgId)) return 1;
  const duration = getPreviewDurationMs(tgId, module ?? 'tests');
  return Math.max(1, Math.round(duration / PREVIEW_TEST_REAL_WINDOW_MS));
}

/** Интервал sync с API: тест — каждую секунду, остальные — раз в минуту. */
export function getPreviewSyncIntervalMs(tgId?: string | null): number {
  return isPreviewShortDurationAccount(tgId) ? 1_000 : PREVIEW_SYNC_INTERVAL_MS;
}

function getLegacyVirtualMsConsumed(
  user: any,
  tgId?: string | null,
  module?: PreviewModule,
): number {
  if (!user?.previewStartedAt) return 0;
  const elapsedReal = Date.now() - Date.parse(user.previewStartedAt);
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const mod = module ?? chosen[0];
  return elapsedReal * getPreviewActiveTimeMultiplier(tgId, mod);
}

export type PreviewStatus = 'selecting' | 'active' | 'expired' | 'confirmed';

export { isPreviewFlowInProgress, hasFinalizedPreviewAccess } from '@/lib/previewStateMachine';

function clearStalePreviewFlowFields(healed: Record<string, any>) {
  clearPreviewFlowFields(healed);
}

/** Все выбранные разделы уже открыты — не запускать пробу/оплату повторно. */
export function userAlreadyHasAllChosenModules(
  user: any,
  subjectId: string,
  modules: PreviewModule[],
): boolean {
  if (!userAlreadyHasSubjectAccess(user, subjectId)) return false;
  const chosen = normalizePreviewModules(modules);
  if (chosen.length === 0) return false;
  const hidden = new Set<string>((user.navHidden?.[subjectId] as string[]) || []);
  return chosen.every(m => !hidden.has(m));
}

/** Админ вручную открыл предмет/разделы — завершить воронку оплаты без «Скинул — войти». */
export function clearPreviewFlowIfAdminGrantedAccess(user: any): any {
  if (!user) return user;
  if (isPreviewFlowInProgress(user)) return user;

  const chosen = user.previewChosenSubject;
  if (!chosen || !isPreviewPaymentFlowActive(user)) return user;
  if (!userAlreadyHasSubjectAccess(user, chosen)) return user;

  const mods = normalizePreviewModules(user.previewChosenModules);
  if (mods.length > 0 && !userAlreadyHasAllChosenModules(user, chosen, mods)) {
    return user;
  }

  const healed: Record<string, any> = { ...user };
  clearStalePreviewFlowFields(healed);
  if (!healed.previewConfirmedAt) {
    healed.previewConfirmedAt = new Date().toISOString();
  }
  if (!healed.paid) healed.paid = true;
  delete healed._adminPaymentOnlyLock;
  return healed;
}

/** Сброс зависшей витрины/оплаты у пользователей с уже выданным доступом. */
export function healStalePreviewForFinalizedUser(user: any): any {
  if (!user) return user;

  if (isPreviewFlowInProgress(user)) return user;
  if (getPendingAdminModules(user).length > 0) return user;

  const inCatalogBrowse = user._catalogBrowse === true;
  let shouldHeal = false;

  if (user.previewConfirmedAt && user.previewStatus) {
    if (!inCatalogBrowse || user.previewStatus === 'active' || user.previewStatus === 'expired') {
      shouldHeal = true;
    }
  }

  if (!shouldHeal && user.paid === true && getUserAvailableSubjects(user).length > 0) {
    const addonInProgress = !!user.previewChosenSubject
      && user._subjectsBeforePreview
      && typeof user._subjectsBeforePreview === 'object'
      && user._subjectsBeforePreview[user.previewChosenSubject] !== true
      && isPreviewPaymentFlowActive(user);
    if (!addonInProgress) {
      if (user.previewStatus === 'active' || user.previewStatus === 'expired') {
        shouldHeal = true;
      } else if (user.previewStatus === 'selecting' && !inCatalogBrowse) {
        shouldHeal = true;
      }
    }
  }

  if (!shouldHeal && hasFinalizedPreviewAccess(user)) {
    const staleSelecting = user.previewStatus === 'selecting' && !inCatalogBrowse;
    const staleExpired = user.previewStatus === 'expired' && !inCatalogBrowse;
    const staleActive = user.previewStatus === 'active';
    if (staleSelecting || staleExpired || staleActive) shouldHeal = true;
  }

  if (!shouldHeal && (user.previewStatus === 'expired' || user.previewStatus === 'selecting')) {
    const chosen = user.previewChosenSubject;
    if (chosen && !user.receiptClaimedAt && userAlreadyHasSubjectAccess(user, chosen)) {
      const mods = normalizePreviewModules(user.previewChosenModules);
      if (mods.length === 0 || userAlreadyHasAllChosenModules(user, chosen, mods)) {
        shouldHeal = true;
      } else {
        const granted = getGrantedModulesForPaymentSubject(user, chosen);
        if (!mods.some(m => !granted.includes(m))) shouldHeal = true;
      }
    }
  }

  if (!shouldHeal) return user;

  const healed: Record<string, any> = { ...user };
  clearStalePreviewFlowFields(healed);
  return healed;
}

export function isPreviewUser(user: any): boolean {
  return !!user?.previewStatus;
}

export type PreviewActiveMsMap = Partial<Record<PreviewModule, number>>;

export function initPreviewActiveMsMap(modules: PreviewModule[]): PreviewActiveMsMap {
  const map: PreviewActiveMsMap = {};
  for (const m of modules) map[m] = 0;
  return map;
}

export function getPreviewActiveMsConsumed(user: any): number {
  const v = Number(user?.previewActiveMsConsumed);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

export function getPreviewActiveMsByModule(user: any): PreviewActiveMsMap {
  const raw = user?.previewActiveMsByModule;
  if (raw && typeof raw === 'object') {
    const map: PreviewActiveMsMap = {};
    for (const m of ['questions', 'tests', 'tasks'] as PreviewModule[]) {
      const v = Number(raw[m]);
      if (Number.isFinite(v) && v >= 0) map[m] = v;
    }
    return map;
  }
  return {};
}

function ensurePreviewActiveMsMap(user: any, chosen: PreviewModule[]): PreviewActiveMsMap {
  const existing = getPreviewActiveMsByModule(user);
  if (chosen.some(m => existing[m] != null)) return existing;
  const legacy = getPreviewActiveMsConsumed(user);
  if (legacy > 0) {
    const map = initPreviewActiveMsMap(chosen);
    for (const m of chosen) map[m] = legacy;
    return map;
  }
  return initPreviewActiveMsMap(chosen);
}

function getModuleActiveMsConsumed(
  user: any,
  module: PreviewModule,
  chosen: PreviewModule[],
  msMap?: PreviewActiveMsMap,
): number {
  const map = msMap ?? ensurePreviewActiveMsMap(user, chosen);
  const perModule = map[module];
  if (perModule != null && perModule > 0) return perModule;
  const anyPerModule = chosen.some(m => (map[m] ?? 0) > 0);
  if (!anyPerModule) return getPreviewActiveMsConsumed(user);
  return perModule ?? 0;
}

function usesLegacySharedTrialClock(user: any, chosen: PreviewModule[]): boolean {
  const map = getPreviewActiveMsByModule(user);
  if (chosen.some(m => (map[m] ?? 0) > 0)) return false;
  return getPreviewActiveMsConsumed(user) <= 0;
}

/** Истекла проба конкретного раздела. */
export function isPreviewModuleTrialExpired(
  user: any,
  module: PreviewModule,
  tgId?: string | null,
): boolean {
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  if (!chosen.includes(module)) return true;
  const statuses = ensureModuleStatusMap(user, user.previewChosenSubject);
  if (statuses[module] !== 'trial') return true;

  const sessionAge = getPreviewSessionAgeMs(user);
  if (sessionAge >= PREVIEW_SESSION_ABSOLUTE_MAX_MS) return true;

  const limit = getPreviewDurationMs(tgId, module);
  const consumed = getModuleActiveMsConsumed(user, module, chosen);
  if (consumed >= limit) return true;

  if (isPreviewShortDurationAccount(tgId)) {
    const since = user?.previewModuleRealSince?.[module];
    if (since && Date.now() - Date.parse(since) >= PREVIEW_TEST_REAL_WINDOW_MS) {
      return true;
    }
  }

  if (
    chosen.length === 1
    && usesLegacySharedTrialClock(user, chosen)
    && user.previewStartedAt
  ) {
    return getLegacyVirtualMsConsumed(user, tgId, module) >= limit;
  }

  return false;
}

/** Проба истекла целиком: не осталось разделов в trial. */
export function isPreviewExpired(user: any, _now = Date.now(), tgId?: string | null): boolean {
  if (user?.previewStatus !== 'active') return false;
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  if (chosen.length === 0) return true;
  const statuses = ensureModuleStatusMap(user, user.previewChosenSubject);
  const trialModules = chosen.filter(m => statuses[m] === 'trial');
  if (trialModules.length === 0) return true;

  return trialModules.every(m => isPreviewModuleTrialExpired(user, m, tgId));
}

export function previewRemainingMsForModule(
  user: any,
  module: PreviewModule,
  tgId?: string | null,
): number {
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  if (!chosen.includes(module)) return 0;
  const statuses = ensureModuleStatusMap(user, user.previewChosenSubject);
  if (statuses[module] !== 'trial') return 0;
  const limit = getPreviewDurationMs(tgId, module);
  const consumed = getModuleActiveMsConsumed(user, module, chosen);
  const sessionAge = getPreviewSessionAgeMs(user);
  const absoluteLeft = PREVIEW_SESSION_ABSOLUTE_MAX_MS - sessionAge;
  const activeLeft = limit - consumed;
  const candidates = [absoluteLeft, activeLeft].filter(n => Number.isFinite(n));
  if (candidates.length === 0) return limit;
  return Math.max(0, Math.min(...candidates));
}

export function previewRemainingMsByModule(user: any, tgId?: string | null): PreviewActiveMsMap {
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const map: PreviewActiveMsMap = {};
  for (const m of chosen) {
    map[m] = previewRemainingMsForModule(user, m, tgId);
  }
  return map;
}

/** Остаток пробы по разделам в целых минутах (обновляется при каждом sync). */
export function previewRemainingMinByModule(user: any, tgId?: string | null): PreviewActiveMsMap {
  const ms = previewRemainingMsByModule(user, tgId);
  const map: PreviewActiveMsMap = {};
  for (const [key, value] of Object.entries(ms)) {
    map[key as PreviewModule] = Math.max(0, Math.ceil((value ?? 0) / 60_000));
  }
  return map;
}

/** Макс. остаток среди разделов, ещё в trial. */
export function previewRemainingMs(user: any, tgId?: string | null): number {
  if (user?.previewStatus !== 'active') return 0;
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const statuses = ensureModuleStatusMap(user, user.previewChosenSubject);
  const trialRemaining = chosen
    .filter(m => statuses[m] === 'trial')
    .map(m => previewRemainingMsForModule(user, m, tgId));
  if (trialRemaining.length === 0) return 0;
  return Math.max(...trialRemaining);
}

export function previewEndsAt(user: any, tgId?: string | null): string | null {
  if (user?.previewStatus !== 'active') return null;
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const statuses = ensureModuleStatusMap(user, user.previewChosenSubject);
  const trialMods = chosen.filter(m => statuses[m] === 'trial');
  if (trialMods.length === 0) return null;

  const remaining = Math.max(
    ...trialMods.map(m => previewRemainingMsForModule(user, m, tgId)),
  );
  if (remaining <= 0) return new Date().toISOString();

  const anyActiveMs = trialMods.some(m => getModuleActiveMsConsumed(user, m, chosen) > 0);
  if (anyActiveMs) {
    return new Date(Date.now() + remaining).toISOString();
  }
  return new Date(Date.now() + remaining).toISOString();
}

function finalizePreviewExpiry(user: any): any {
  const base: Record<string, any> = {
    ...user,
    previewStatus:    'expired' as PreviewStatus,
    previewExpiredAt: new Date().toISOString(),
  };
  if (user._subjectsBeforePreview && typeof user._subjectsBeforePreview === 'object') {
    return { ...base, subjects: { ...user._subjectsBeforePreview } };
  }
  return { ...base, subjects: createDefaultSubjects() };
}

/** По таймеру переводит разделы из trial в awaiting_payment по одному. */
export function applyModuleTrialExpiries(user: any, tgId?: string | null): any {
  const subject = user?.previewChosenSubject;
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  if (!subject || chosen.length === 0) return user;

  const statuses: PreviewModuleStatusMap = { ...ensureModuleStatusMap(user, subject) };
  const hasTrial = chosen.some(m => statuses[m] === 'trial');
  if (!hasTrial) return user;
  const msMap = ensurePreviewActiveMsMap(user, chosen);
  let changed = false;

  for (const m of chosen) {
    if (statuses[m] !== 'trial') continue;
    if (isPreviewModuleTrialExpired({ ...user, previewActiveMsByModule: msMap }, m, tgId)) {
      statuses[m] = 'awaiting_payment';
      changed = true;
    }
  }

  if (!changed) return user;

  const confirmed = chosen.filter(m => statuses[m] === 'confirmed');
  let next: Record<string, any> = {
    ...user,
    previewModuleStatuses: statuses,
    previewActiveMsByModule: msMap,
    navHidden: {
      ...(user.navHidden || {}),
      [subject]: buildNavHiddenForPaymentTabs(subject, chosen, confirmed),
    },
  };

  if (!chosen.some(m => statuses[m] === 'trial')) {
    next = finalizePreviewExpiry(next);
  }

  return next;
}

function touchPreviewModuleRealSince(
  user: any,
  module: PreviewModule,
  tgId?: string | null,
): any {
  if (!isPreviewShortDurationAccount(tgId)) return user;
  const realSince = { ...(user.previewModuleRealSince || {}) };
  if (realSince[module]) return user;
  realSince[module] = new Date().toISOString();
  return { ...user, previewModuleRealSince: realSince };
}

function expireTestAccountModuleIfWallClockElapsed(
  user: any,
  module: PreviewModule,
  tgId?: string | null,
): any | null {
  if (!isPreviewShortDurationAccount(tgId)) return null;
  const since = user?.previewModuleRealSince?.[module];
  if (!since || Date.now() - Date.parse(since) < PREVIEW_TEST_REAL_WINDOW_MS) return null;
  const chosen = normalizePreviewModules(user.previewChosenModules);
  const msMap = ensurePreviewActiveMsMap(user, chosen);
  const limit = getPreviewDurationMs(tgId, module);
  return applyModuleTrialExpiries({
    ...user,
    previewActiveMsByModule: { ...msMap, [module]: limit },
  }, tgId);
}

/** Клиент шлёт дельту активного времени для текущего раздела. */
export function syncPreviewActiveMs(
  user: any,
  module: PreviewModule | null | undefined,
  deltaMs: number,
  tgId?: string | null,
): any {
  if (!user) return user;
  const chosen = normalizePreviewModules(user.previewChosenModules);
  if (!module || !chosen.includes(module)) return user;

  const statuses = ensureModuleStatusMap(user, user.previewChosenSubject);
  if (statuses[module] !== 'trial') return user;

  let working = touchPreviewModuleRealSince(user, module, tgId);
  const wallExpired = expireTestAccountModuleIfWallClockElapsed(working, module, tgId);
  if (wallExpired) return wallExpired;

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return working;

  const msMap = ensurePreviewActiveMsMap(working, chosen);
  const limit = getPreviewDurationMs(tgId, module);
  const prev = msMap[module] ?? 0;
  const effectiveDelta = Math.round(deltaMs * getPreviewActiveTimeMultiplier(tgId, module));
  const nextVal = Math.min(limit, prev + effectiveDelta);
  const nextMap: PreviewActiveMsMap = { ...msMap, [module]: nextVal };
  const globalMax = Math.max(getPreviewActiveMsConsumed(user), nextVal);

  const updated = {
    ...working,
    previewActiveMsByModule: nextMap,
    previewActiveMsConsumed: globalMax,
  };

  return applyModuleTrialExpiries(updated, tgId);
}

export function getAllPickableSubjectIds(): string[] {
  return SUBJECTS.map(s => s.id);
}

/** Аккаунт с ключом или уже выданными предметами (не новый гость по коду). */
export function isEstablishedAccount(user: any): boolean {
  if (!user) return false;
  const key = String(user.activatedKey || '').trim();
  if (/^\d{8}$/.test(key)) return true;
  if (hasFinalizedPreviewAccess(user)) return true;
  const granted = getUserAvailableSubjects(user);
  return granted.length > 0 && user.previewStatus !== 'selecting' && user.previewStatus !== 'active';
}

/** Предмет уже был открыт до витрины (админ / ключ). */
export function userAlreadyHasSubjectAccess(user: any, subjectId: string): boolean {
  if (!user) return false;
  if (user.subjects && typeof user.subjects === 'object') {
    return user.subjects[subjectId] === true;
  }
  return getUserAvailableSubjects(user).includes(subjectId);
}

export function snapshotSubjects(user: any): Record<string, boolean> | null {
  if (user?.subjects && typeof user.subjects === 'object') {
    const snap = { ...user.subjects };
    if (Object.values(snap).some(v => v === true)) return snap;
  }
  const granted = getUserAvailableSubjects(user);
  if (granted.length === 0) return null;
  const snap = createDefaultSubjects();
  for (const id of granted) snap[id] = true;
  return snap;
}

/** Идёт проба или оплата (в т.ч. докупка после прошлого подтверждения). */
export function isPreviewPaymentFlowActive(user: any): boolean {
  return user?.previewStatus === 'active'
    || user?.previewStatus === 'expired'
    || !!user?.receiptClaimedAt;
}

/** Разделы заявки для админки: поле, navHidden или статусы модулей. */
export function getPreviewChosenModulesForAdmin(user: any): PreviewModule[] {
  const subject = user?.previewChosenSubject;
  if (!subject) return [];

  const fromField = inferChosenModulesForConfirm(user, subject);
  if (fromField.length > 0) return fromField;

  const statuses = user?.previewModuleStatuses;
  if (statuses && typeof statuses === 'object') {
    const fromStatuses = (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(
      m => statuses[m] != null,
    );
    if (fromStatuses.length > 0) return fromStatuses;
  }
  return [];
}

/** Есть ли хотя бы один раздел, ожидающий действия админа. */
export function previewChoiceNeedsAdminConfirm(user: any): boolean {
  return getPendingAdminModules(user).length > 0;
}

/** Разделы, по которым админу показываются кнопки ✓ / отказ (после «Скинул — войти»). */
export function getPendingAdminModules(user: any): PreviewModule[] {
  const chosen = user?.previewChosenSubject;
  if (!chosen) return [];
  if (!isPreviewPaymentFlowActive(user) && hasFinalizedPreviewAccess(user)) return [];

  const allChosen = getPreviewChosenModulesForAdmin(user);
  const statuses = ensureModuleStatusMap(user, chosen);
  const pending = allChosen.filter(m => statuses[m] === 'receipt_pending');
  if (pending.length > 0) return pending;

  const fromStatuses = (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(
    m => statuses[m] === 'receipt_pending',
  );
  if (fromStatuses.length > 0) return fromStatuses;

  // Legacy: один блок подтверждения без previewModuleStatuses
  if (user.receiptClaimedAt && !user.previewModuleStatuses) {
    return allChosen;
  }
  return [];
}

/** Докупка: предмет или разделы уже были до текущей заявки. */
export function isAddonPreviewPurchase(
  user: any,
  subjectId: string,
  before: Record<string, boolean> | null,
  options?: { catalogAddon?: boolean },
): boolean {
  if (options?.catalogAddon === true && userAlreadyHasSubjectAccess(user, subjectId)) {
    return true;
  }
  if (!before) return false;
  if (before[subjectId] === true) return true;
  return Object.entries(before).some(([id, v]) => v === true && id !== subjectId);
}

/** Докупка разделов на предмете, который уже был открыт до пробы. */
export function isSameSubjectAddonPreview(user: any, subjectId?: string): boolean {
  const chosen = subjectId || user?.previewChosenSubject;
  if (!chosen || !isPreviewPaymentFlowActive(user)) return false;
  if (user._subjectsBeforePreview?.[chosen] === true) return true;
  if (user._previewSnapshotBeforeAddon) return true;
  return userAlreadyHasSubjectAccess(user, chosen) && !!user._navHiddenBeforePreview;
}

/** navHidden до начала пробы — для определения уже купленных разделов. */
export function navHiddenBaseForGrantedModules(user: any): Record<string, string[]> {
  if (user._navHiddenBeforePreview && typeof user._navHiddenBeforePreview === 'object') {
    return user._navHiddenBeforePreview;
  }
  return (user.navHidden && typeof user.navHidden === 'object') ? user.navHidden : {};
}

export function grantedSubjectsForAddon(user: any, subjectId: string): string[] {
  const ids = new Set(getCatalogGrantedSubjects(user));
  if (user.subjects?.[subjectId] === true || user._subjectsBeforePreview?.[subjectId] === true) {
    ids.add(subjectId);
  }
  return [...ids];
}

/** Навигация при докупке: купленные разделы + выбранные для пробы/оплаты. */
export function buildSubjectAddonNavHidden(
  user: any,
  subjectId: string,
  chosenModules: PreviewModule[],
): string[] {
  return buildNavHiddenForCatalogAddonPreview(
    subjectId,
    chosenModules,
    grantedSubjectsForAddon(user, subjectId),
    navHiddenBaseForGrantedModules(user),
  );
}

/** Починить navHidden, если при докупке скрылись уже открытые разделы. */
export function normalizeAddonPreviewNavHidden(user: any): any {
  const subjectId = user?.previewChosenSubject;
  if (!subjectId || !isPreviewPaymentFlowActive(user)) return user;
  const chosen = normalizePreviewModules(user.previewChosenModules);
  if (chosen.length === 0 || !isSameSubjectAddonPreview(user, subjectId)) return user;

  const fixed = buildSubjectAddonNavHidden(user, subjectId, chosen);
  const current = user.navHidden?.[subjectId];
  if (
    Array.isArray(current)
    && current.length === fixed.length
    && current.every((t: string) => fixed.includes(t))
  ) {
    return user;
  }
  return {
    ...user,
    navHidden: { ...(user.navHidden || {}), [subjectId]: fixed },
  };
}

/** У пользователя уже были другие предметы — заявка на докупку. */
export function previewChoiceIsAddon(user: any): boolean {
  const chosen = user?.previewChosenSubject;
  if (!chosen) return false;
  const inFlow = user.previewStatus === 'active'
    || user.previewStatus === 'expired'
    || !!user.receiptClaimedAt;
  if (!inFlow) return false;

  const before = user._subjectsBeforePreview;
  if (before && typeof before === 'object') {
    if (before[chosen] === true) return true;
    return Object.entries(before).some(([id, v]) => v === true && id !== chosen);
  }
  if (user._previewSnapshotBeforeAddon) return true;

  const grants = user.subjects && typeof user.subjects === 'object' ? user.subjects : null;
  if (grants) {
    return Object.entries(grants).some(([id, v]) => v === true && id !== chosen);
  }
  return /^\d{8}$/.test(String(user.activatedKey || '').trim());
}

type RedisSetOps = {
  sismember: (key: string, member: string | number) => Promise<unknown>;
  srem:      (key: string, ...members: (string | number)[]) => Promise<unknown>;
  smembers:  (key: string) => Promise<unknown>;
};

const PREVIEW_DEMO_RESET_FIELDS = [
  'previewStatus',
  'previewStartedAt',
  'previewPickedAt',
  'previewExpiredAt',
  'previewConfirmedAt',
  'previewQuotedPrice',
  'receiptClaimedAt',
  '_adminPaymentOnlyLock',
  'previewModuleStatuses',
  'previewActiveMsConsumed',
  'previewActiveMsByModule',
  'previewModuleTrustExpiresAt',
  '_navHiddenBeforePreview',
  '_subjectsBeforePreview',
  '_previewSnapshotBeforeAddon',
  '_previewStatusBeforeCatalog',
  '_catalogBrowse',
  'previewFacultyRecordedAt',
  'previewPaymentSelection',
] as const;

/** Сброс пробного доступа: факультет и выбор предмета/разделов сохраняем, группу — заново. */
export function resetPreviewDemoAccess(user: any): any {
  const promo = resolveUserFacultyPromo(user);
  const preservedSubject = String(user?.previewChosenSubject || '').trim() || null;
  const preservedModules = preservedSubject
    ? getPreviewChosenModulesForAdmin(user)
    : [];
  const patched: Record<string, any> = { ...user };

  for (const field of PREVIEW_DEMO_RESET_FIELDS) {
    delete patched[field];
  }

  delete patched.studyGroup;

  const key = patched.activatedKey;
  if (key === 'preview' || (key && String(key).startsWith('promo:'))) {
    delete patched.activatedKey;
  }

  if (preservedSubject && patched.subjects && typeof patched.subjects === 'object') {
    patched.subjects = { ...patched.subjects, [preservedSubject]: false };
  }

  if (!promo) {
    delete patched.facultyId;
    delete patched.previewFaculty;
    delete patched.promoCode;
    delete patched.previewChosenSubject;
    delete patched.previewChosenModules;
    return patched;
  }

  const withFaculty = applyFacultyToUser(patched, promo);
  withFaculty.previewStatus = 'selecting';
  withFaculty.studyGroup = null;
  withFaculty.activatedKey = `promo:${promo.id}`;
  if (preservedSubject) {
    withFaculty.previewChosenSubject = preservedSubject;
  }
  if (preservedModules.length > 0) {
    withFaculty.previewChosenModules = preservedModules;
  }
  return withFaculty;
}

/** После сброса и ввода группы — снова открыть пробу с сохранённым выбором. */
export function resumePreviewTrialAfterGroup(user: any): any | null {
  if (user?.previewStatus !== 'selecting') return null;
  const subjectId = String(user.previewChosenSubject || '').trim();
  const modules = getPreviewChosenModulesForAdmin(user);
  if (!subjectId || modules.length === 0) return null;
  if (!String(user.studyGroup || '').trim()) return null;
  return buildActivePreviewUser(user, subjectId, modules);
}

/** Снимает блокировку «пробный уже использован» для TG ID (string/number в Redis). */
export async function clearPreviewTrialLock(redis: RedisSetOps, tgId: string) {
  const id = String(tgId).trim();
  await redis.srem('used_demo_ids', id);
  const num = Number(id);
  if (Number.isSafeInteger(num)) await redis.srem('used_demo_ids', num);
  try {
    const members = await redis.smembers('used_demo_ids');
    if (Array.isArray(members)) {
      for (const m of members) {
        if (String(m) === id) await redis.srem('used_demo_ids', m as string | number);
      }
    }
  } catch { /* ignore */ }
}

export async function isPreviewTrialLocked(redis: RedisSetOps, tgId: string): Promise<boolean> {
  const id = String(tgId).trim();
  if (await redis.sismember('used_demo_ids', id)) return true;
  const num = Number(id);
  if (Number.isSafeInteger(num) && await redis.sismember('used_demo_ids', num)) return true;
  return false;
}

export function buildSelectingPreviewUser(
  profile: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  },
  promo?: FacultyPromo,
) {
  const now = new Date().toISOString();
  return {
    activatedKey:       promo ? `promo:${promo.id}` : null,
    previewStatus:      'selecting' as PreviewStatus,
    previewFaculty:     promo?.facultyLabel ?? null,
    facultyId:          promo?.id ?? null,
    promoCode:          promo?.code ?? null,
    subjects:           createDefaultSubjects(),
    date:               now,
    username:           profile.username,
    firstName:          profile.firstName,
    lastName:           profile.lastName,
    _migrated_subjects: true,
    loginCount:         0,
  };
}

/** Код из канала для уже существующего аккаунта — витрина без сброса доступа. */
export function buildSelectingPreviewUserFromExisting(
  user: any,
  profile: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  },
  promo: FacultyPromo,
  opts?: { forceNewGroup?: boolean },
) {
  const now = new Date().toISOString();
  const facultyChanged = !!user.facultyId && user.facultyId !== promo.id;
  const clearGroup = opts?.forceNewGroup === true || facultyChanged;
  return {
    ...user,
    previewStatus:              'selecting' as PreviewStatus,
    previewFaculty:             promo.facultyLabel,
    facultyId:                  promo.id,
    promoCode:                  promo.code,
    studyGroup:                 clearGroup ? null : (user.studyGroup ?? null),
    previewChosenSubject:       null,
    previewChosenModules:       null,
    previewStartedAt:           null,
    previewExpiredAt:           null,
    _previewStatusBeforeCatalog: user.previewStatus ?? null,
    username:                   profile.username ?? user.username,
    firstName:            profile.firstName ?? user.firstName,
    lastName:             profile.lastName ?? user.lastName,
    lastLogin:            now,
    loginCount:           Number(user.loginCount || 0) + 1,
    _migrated_subjects:   true,
  };
}

/** Выбран уже открытый предмет — только фиксируем факультет, доступ не меняем. */
export function recordFacultyChoiceOnly(
  user: any,
  subjectId: string,
  chosenModules: PreviewModule[],
) {
  const now = new Date().toISOString();
  const prev = user._previewStatusBeforeCatalog;
  const restoreStatus = prev === 'confirmed' ? 'confirmed' : null;
  return {
    ...user,
    previewStatus:            restoreStatus,
    previewChosenSubject:     subjectId,
    previewChosenModules:     chosenModules,
    previewFacultyRecordedAt: now,
    previewStartedAt:         null,
    previewExpiredAt:         null,
    _subjectsBeforePreview:     undefined,
    _previewStatusBeforeCatalog: undefined,
  };
}

export function buildActivePreviewUser(
  user: any,
  subjectId: string,
  chosenModules: PreviewModule[],
  options?: { catalogAddon?: boolean },
) {
  const before = snapshotSubjects(user);
  const subjects = before ? { ...before } : createDefaultSubjects();
  subjects[subjectId] = true;
  const now = new Date().toISOString();
  const isCatalogAddon = options?.catalogAddon === true
    && userAlreadyHasSubjectAccess(user, subjectId);
  const isAddonPurchase = isAddonPreviewPurchase(user, subjectId, before, options);
  const isSubjectAddon = isAddonPurchase && (
    before?.[subjectId] === true || userAlreadyHasSubjectAccess(user, subjectId)
  );
  const hiddenTabs = isSubjectAddon
    ? buildSubjectAddonNavHidden(user, subjectId, chosenModules)
    : buildNavHiddenForPreview(subjectId, chosenModules);
  const navHidden = { ...(user.navHidden || {}), [subjectId]: hiddenTabs };
  const navHiddenBeforePreview = (isCatalogAddon || isAddonPurchase)
    ? { ...(user.navHidden || {}) }
    : user._navHiddenBeforePreview;
  const snapshotBeforeAddon = isAddonPurchase
    ? {
      previewConfirmedAt: user.previewConfirmedAt ?? null,
      paid:               user.paid === true,
    }
    : user._previewSnapshotBeforeAddon;

  return {
    ...user,
    previewStatus:          'active' as PreviewStatus,
    previewChosenSubject:   subjectId,
    previewChosenModules:   chosenModules,
    previewQuotedPrice:     calcPreviewPriceRub(subjectId, chosenModules, {
      bioHadTest: subjectId === 'bio' ? bioUserHadTest(chosenModules) : undefined,
    }),
    previewStartedAt:       now,
    previewPickedAt:          now,
    previewConfirmedAt:       null,
    previewExpiredAt:         null,
    receiptClaimedAt:         null,
    previewActiveMsConsumed:  0,
    previewActiveMsByModule:  initPreviewActiveMsMap(chosenModules),
    previewModuleStatuses:    syncModuleStatusesOnPick(chosenModules),
    paid:                     false,
    subjects,
    navHidden,
    _subjectsBeforePreview: before,
    _navHiddenBeforePreview: navHiddenBeforePreview,
    _previewSnapshotBeforeAddon: snapshotBeforeAddon,
    _migrated_subjects:     true,
  };
}

/** Админ принудительно оставил только экраны оплаты — без выхода и восстановления пробы. */
export function isAdminPaymentOnlyLocked(user: any): boolean {
  return user?._adminPaymentOnlyLock === true;
}

/** Предметы, уже открыты до текущей заявки на оплату. */
export function getPaymentGrantedSubjects(user: any): string[] {
  if (isAdminPaymentOnlyLocked(user)) return [];
  const granted = getCatalogGrantedSubjects(user);
  if (granted.length > 0) return granted;
  const chosen = user?.previewChosenSubject;
  if (chosen && isPreviewPaymentFlowActive(user)) {
    const subs = user.subjects && typeof user.subjects === 'object' ? user.subjects : {};
    const fromSubjects = Object.entries(subs)
      .filter(([id, v]) => v === true && id !== chosen)
      .map(([id]) => id);
    if (fromSubjects.length > 0) return fromSubjects;
  }
  // В пробе subjects[subject]=true даёт доступ к trial — это не покупка
  if (
    user?.previewChosenSubject
    && (user.previewStatus === 'active'
      || user.previewStatus === 'expired'
      || user.receiptClaimedAt)
  ) {
    return [];
  }
  return [];
}

/** Купленные разделы предмета на экране оплаты. */
export function getGrantedModulesForPaymentSubject(user: any, subjectId: string): PreviewModule[] {
  return getGrantedCatalogModules(
    subjectId,
    grantedSubjectsForAddon(user, subjectId),
    navHiddenBaseForGrantedModules(user),
  );
}

/** Разделы, уже куплены до текущей заявки на докупку (для экрана оплаты). */
export function getPreviewPaymentGrantedModules(user: any): PreviewModule[] {
  const chosen = user?.previewChosenSubject;
  if (!chosen) return [];
  return getGrantedModulesForPaymentSubject(user, chosen);
}

export function defaultPaymentModulesForSubject(
  subjectId: string,
  granted: PreviewModule[],
): PreviewModule[] {
  const row = getPaymentModuleRow(subjectId, granted);
  const pickable = row.filter(o => o.selectable && !o.alreadyOwned).map(o => o.id);
  if (pickable.length === 0) return [];
  if (pickable.includes('tests')) return ['tests'];
  return [pickable[0]];
}

/** Докупка: предмет уже был открыт до пробы — можно вернуться без оплаты. */
export function canReturnToPurchasedAccess(user: any): boolean {
  if (isAdminPaymentOnlyLocked(user)) return false;
  const chosen = user?.previewChosenSubject;
  if (!chosen || user.receiptClaimedAt) return false;
  if (user.previewStatus !== 'expired' && user.previewStatus !== 'active') return false;
  const before = user._subjectsBeforePreview;
  return !!(before && typeof before === 'object' && before[chosen] === true);
}

/** Можно отменить незавершённую заявку и вернуться к уже открытым предметам. */
export function canAbandonPendingPreview(user: any): boolean {
  if (isAdminPaymentOnlyLocked(user)) return false;
  const chosen = user?.previewChosenSubject;
  if (!chosen || user.receiptClaimedAt) return false;
  if (user.previewStatus !== 'expired' && user.previewStatus !== 'active') return false;
  if (user._previewSnapshotBeforeAddon) return true;
  const before = user._subjectsBeforePreview;
  if (before && typeof before === 'object') {
    return Object.values(before).some(v => v === true);
  }
  return false;
}

/** Отменить незавершённую докупку — восстановить ранее купленные предметы и разделы. */
export function abandonPendingPreviewPayment(user: any) {
  if (isAdminPaymentOnlyLocked(user)) return null;
  const chosen = user?.previewChosenSubject;
  if (!chosen || user.receiptClaimedAt) return null;
  if (user.previewStatus !== 'expired' && user.previewStatus !== 'active') return null;
  if (!canAbandonPendingPreview(user)) return null;

  const beforeSubjects = user._subjectsBeforePreview;
  const subjects = beforeSubjects && typeof beforeSubjects === 'object'
    ? { ...beforeSubjects }
    : createDefaultSubjects();

  let navHidden: Record<string, string[]>;
  if (user._navHiddenBeforePreview && typeof user._navHiddenBeforePreview === 'object') {
    navHidden = { ...user._navHiddenBeforePreview };
  } else {
    navHidden = { ...(user.navHidden || {}) };
    delete navHidden[chosen];
  }
  const snap = user._previewSnapshotBeforeAddon;

  const updated: Record<string, any> = {
    ...user,
    subjects,
    navHidden,
    previewChosenSubject: null,
    previewChosenModules: null,
    previewQuotedPrice:   null,
    previewStartedAt:     null,
    previewExpiredAt:     null,
    previewPickedAt:      null,
    receiptClaimedAt:     null,
    previewActiveMsConsumed: null,
    previewActiveMsByModule:        null,
    previewModuleStatuses:          null,
    previewModuleTrustExpiresAt:    null,
    _subjectsBeforePreview:    undefined,
    _navHiddenBeforePreview:   undefined,
    _previewSnapshotBeforeAddon: undefined,
  };
  delete updated.previewActiveMsConsumed;
  delete updated.previewActiveMsByModule;
  delete updated.previewModuleStatuses;
  delete updated.previewModuleTrustExpiresAt;
  if (snap?.previewConfirmedAt) {
    updated.previewConfirmedAt = snap.previewConfirmedAt;
  } else {
    delete updated.previewConfirmedAt;
  }
  if (snap?.paid === true) {
    updated.paid = true;
  } else {
    delete updated.paid;
  }
  delete updated.previewStatus;
  delete updated._catalogBrowse;
  return updated;
}

/** @deprecated use abandonPendingPreviewPayment */
export const abandonPendingCatalogAddon = abandonPendingPreviewPayment;

/** Проба закончилась — ждём оплату на экране previewPricing. */
export function hasPendingPreviewPayment(user: any): boolean {
  if (!user?.previewChosenSubject) return false;
  if (user.previewStatus === 'expired') return true;
  return !!user.receiptClaimedAt && !user.previewConfirmedAt;
}

function restoreNavHiddenAfterPreviewExpire(user: any): Record<string, string[]> {
  const navHidden = { ...(user.navHidden || {}) };
  const subject = user.previewChosenSubject;
  const base = (user._navHiddenBeforePreview && typeof user._navHiddenBeforePreview === 'object')
    ? user._navHiddenBeforePreview
    : null;
  if (!subject || !base) return navHidden;
  if (Array.isArray(base[subject])) {
    navHidden[subject] = [...base[subject]];
  } else {
    delete navHidden[subject];
  }
  return navHidden;
}

export function expirePreviewUser(user: any) {
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const subject = user?.previewChosenSubject;
  const statuses = setAllModuleStatuses(
    chosen,
    'awaiting_payment',
    ensureModuleStatusMap(user, subject),
  );
  const confirmed = chosen.filter(m => statuses[m] === 'confirmed');
  let navHidden = { ...(user.navHidden || {}) };
  if (subject && chosen.length > 0) {
    navHidden = {
      ...navHidden,
      [subject]: isSameSubjectAddonPreview(user, subject)
        ? buildSubjectAddonNavHidden(user, subject, chosen)
        : buildNavHiddenForPaymentTabs(subject, chosen, confirmed),
    };
  } else {
    navHidden = restoreNavHiddenAfterPreviewExpire(user);
  }

  return finalizePreviewExpiry({
    ...user,
    previewModuleStatuses: statuses,
    navHidden,
  });
}

/** Админ: сбросить пробу и оставить только экраны оплаты (без доступа к контенту). */
export function adminForcePaymentOnlyScreen(user: any): any | null {
  if (!user) return null;

  let subjectId = user.previewChosenSubject as string | null;
  let chosen = normalizePreviewModules(user.previewChosenModules);

  if (!subjectId) {
    const available = getUserAvailableSubjects(user);
    subjectId = available[0] ?? null;
  }
  if (!subjectId) return null;

  if (chosen.length === 0) {
    chosen = inferChosenModulesForConfirm(user, subjectId);
  }
  if (chosen.length === 0) {
    const granted = getGrantedModulesForPaymentSubject(user, subjectId);
    const row = getPaymentModuleRow(subjectId, granted);
    chosen = row.filter(o => o.selectable && !o.alreadyOwned).map(o => o.id);
  }
  if (chosen.length === 0) {
    const hidden = new Set(getNavHiddenForSubject(subjectId));
    chosen = (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(m => !hidden.has(m));
  }
  if (chosen.length === 0) return null;

  const msMap: PreviewActiveMsMap = {};
  for (const m of chosen) msMap[m] = getPreviewDurationMs(null, m);
  const consumedMax = Math.max(0, ...chosen.map(m => msMap[m] ?? 0));

  const statuses = setAllModuleStatuses(
    chosen,
    'awaiting_payment',
    ensureModuleStatusMap(user, subjectId),
  );

  const navHidden = {
    ...(user.navHidden || {}),
    [subjectId]: buildNavHiddenForPaymentTabs(subjectId, chosen, []),
  };

  const now = new Date().toISOString();

  const updated: Record<string, any> = {
    ...user,
    previewStatus: 'expired' as PreviewStatus,
    previewExpiredAt: now,
    previewChosenSubject: subjectId,
    previewChosenModules: chosen,
    previewModuleStatuses: statuses,
    previewActiveMsByModule: msMap,
    previewActiveMsConsumed: consumedMax,
    previewQuotedPrice: calcPreviewPriceRub(subjectId, chosen, {
      bioHadTest: subjectId === 'bio'
        ? bioUserHadTest(chosen, getGrantedModulesForPaymentSubject(user, subjectId))
        : undefined,
    }),
    previewStartedAt: user.previewStartedAt || now,
    receiptClaimedAt: null,
    previewConfirmedAt: null,
    previewModuleTrustExpiresAt: undefined,
    subjects: createDefaultSubjects(),
    navHidden,
    _adminPaymentOnlyLock: true,
    _migrated_subjects: true,
    _catalogBrowse: undefined,
    _previewStatusBeforeCatalog: undefined,
    paid: false,
  };

  delete updated._subjectsBeforePreview;
  delete updated._navHiddenBeforePreview;
  delete updated._previewSnapshotBeforeAddon;

  return updated;
}

/** Разделы из заявки: сначала previewChosenModules, иначе из navHidden активной пробы. */
export function inferChosenModulesForConfirm(user: any, subjectId: string): PreviewModule[] {
  const fromField = normalizePreviewModules(user?.previewChosenModules);
  if (fromField.length > 0) return fromField;

  const hiddenList = user?.navHidden?.[subjectId];
  if (Array.isArray(hiddenList)) {
    const hidden = new Set(hiddenList.map(String));
    const inferred = (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(
      m => !hidden.has(m),
    );
    if (inferred.length > 0) return inferred;
  }

  return [];
}

/** Студент меняет разделы на экране оплаты — пересчёт суммы и заявки. */
export function updatePreviewPaymentChoice(
  user: any,
  modules: PreviewModule[],
  subjectId?: string,
) {
  const subject = subjectId || user?.previewChosenSubject;
  if (!subject) return null;
  if (user.receiptClaimedAt || hasFinalizedPreviewAccess(user)) return null;

  const granted = getGrantedModulesForPaymentSubject(user, subject);
  const paymentPick = normalizePreviewModules(modules).filter(m => !granted.includes(m));
  if (paymentPick.length === 0) return null;

  const existingChosen = normalizePreviewModules(user.previewChosenModules);
  const chosen = [...new Set([...existingChosen, ...paymentPick])];

  const before = user._subjectsBeforePreview;
  const isAddon = before && typeof before === 'object' && before[subject] === true;
  const hiddenTabs = isAddon
    ? buildSubjectAddonNavHidden(user, subject, chosen)
    : buildNavHiddenForPaymentTabs(subject, chosen, chosen.filter(m => granted.includes(m)));
  const navHidden = { ...(user.navHidden || {}), [subject]: hiddenTabs };

  const statuses: PreviewModuleStatusMap = { ...ensureModuleStatusMap(user, subject) };
  const msMap = ensurePreviewActiveMsMap(user, chosen);
  const probeUser = { ...user, previewActiveMsByModule: msMap };
  const tgId = user?.telegramId != null ? String(user.telegramId) : null;
  for (const m of chosen) {
    if (statuses[m] === 'confirmed' || statuses[m] === 'receipt_pending') continue;
    if (statuses[m] === 'rejected') {
      statuses[m] = 'rejected';
      continue;
    }
    if (!paymentPick.includes(m) && statuses[m] === 'trial') continue;
    if (
      statuses[m] === 'awaiting_payment'
      || user.previewStatus === 'expired'
      || isPreviewModuleTrialExpired(probeUser, m, tgId)
    ) {
      statuses[m] = 'awaiting_payment';
    } else if (paymentPick.includes(m)) {
      statuses[m] = 'trial';
    }
  }
  for (const m of ['questions', 'tests', 'tasks'] as PreviewModule[]) {
    if (!chosen.includes(m) && statuses[m] !== 'confirmed') {
      delete statuses[m];
    }
  }

  return {
    ...user,
    previewChosenSubject: subject,
    previewChosenModules: chosen,
    previewPaymentSelection: paymentPick,
    previewQuotedPrice:   calcPreviewPriceRub(subject, paymentPick, {
      bioHadTest: subject === 'bio' ? bioUserHadTest(chosen, granted) : undefined,
    }),
    previewModuleStatuses: statuses,
    navHidden,
  };
}

/** Смена предмета на экране оплаты. */
export function switchPreviewPaymentSubject(
  user: any,
  subjectId: string,
  modules?: PreviewModule[],
) {
  if (!user?.previewChosenSubject) return null;
  if (user.receiptClaimedAt || hasFinalizedPreviewAccess(user)) return null;
  if (user.previewStatus !== 'expired' && user.previewStatus !== 'active') return null;

  const granted = getGrantedModulesForPaymentSubject(user, subjectId);
  const chosen = modules && modules.length > 0
    ? normalizePreviewModules(modules).filter(m => !granted.includes(m))
    : defaultPaymentModulesForSubject(subjectId, granted);
  if (chosen.length === 0) return null;

  const navHidden = { ...(user.navHidden || {}) };
  const oldSubject = user.previewChosenSubject;
  if (oldSubject && oldSubject !== subjectId) {
    const base = user._navHiddenBeforePreview;
    if (base && typeof base === 'object' && Array.isArray(base[oldSubject])) {
      navHidden[oldSubject] = [...base[oldSubject]];
    } else {
      delete navHidden[oldSubject];
    }
  }

  return updatePreviewPaymentChoice(
    { ...user, previewChosenSubject: subjectId, navHidden },
    chosen,
    subjectId,
  );
}

/** Студент нажал «Скинул чек» — ждём поэтапного подтверждения админа по разделам. */
export function claimPreviewReceipt(user: any, modulesToClaim?: PreviewModule[]) {
  const chosen = user?.previewChosenSubject;
  if (!chosen) return null;
  if (hasFinalizedPreviewAccess(user) && !isPreviewPaymentFlowActive(user)) return user;

  const allChosen = getPreviewChosenModulesForAdmin(user);
  const payable = modulesToClaim && modulesToClaim.length > 0
    ? normalizePreviewModules(modulesToClaim).filter(m => {
      const st = ensureModuleStatusMap(user, chosen)[m];
      if (st === 'confirmed' || st === 'receipt_pending') return false;
      return allChosen.includes(m)
        && (st === 'awaiting_payment' || st === 'rejected' || st === 'trial');
    })
    : modulesAwaitingPayment(ensureModuleStatusMap(user, chosen));
  if (payable.length === 0) return null;

  const statuses: PreviewModuleStatusMap = { ...ensureModuleStatusMap(user, chosen) };
  const trustExpires: Record<string, string> = {
    ...(user.previewModuleTrustExpiresAt && typeof user.previewModuleTrustExpiresAt === 'object'
      ? user.previewModuleTrustExpiresAt
      : {}),
  };
  const trustDeadline = new Date(Date.now() + PREVIEW_RECEIPT_TRUST_MS).toISOString();
  // Час доступа «на доверии» — один раз на раздел предмета. Раньше после
  // автоотказа (час прошёл, админ не подтвердил) можно было снова нажать
  // «Скинул чек» и получить ещё час — и так бесконечно без оплаты.
  // Повторная заявка ждёт админа без доступа и без автоотказа.
  const trustUsed: Record<string, true> = {
    ...(user.previewModuleTrustUsed && typeof user.previewModuleTrustUsed === 'object'
      ? user.previewModuleTrustUsed
      : {}),
  };
  const payableSet = new Set(payable);
  for (const m of payable) {
    statuses[m] = 'receipt_pending';
    const trustKey = `${chosen}:${m}`;
    if (trustUsed[trustKey]) {
      delete trustExpires[m];
    } else {
      trustExpires[m] = trustDeadline;
      trustUsed[trustKey] = true;
    }
  }
  // Невыбранные разделы больше не «висят» в пробе — сразу экран оплаты.
  for (const m of allChosen) {
    if (payableSet.has(m)) continue;
    if (statuses[m] === 'confirmed' || statuses[m] === 'receipt_pending') continue;
    if (statuses[m] === 'trial' || !statuses[m]) {
      statuses[m] = 'awaiting_payment';
    }
  }

  const subjects = user.subjects && typeof user.subjects === 'object'
    ? { ...user.subjects }
    : createDefaultSubjects();
  subjects[chosen] = true;

  const navHidden = {
    ...(user.navHidden || {}),
    [chosen]: isSameSubjectAddonPreview(user, chosen)
      ? buildSubjectAddonNavHidden(user, chosen, allChosen)
      : buildNavHiddenForPaymentTabs(chosen, allChosen, allChosen),
  };

  return {
    ...user,
    subjects,
    receiptClaimedAt:           user.receiptClaimedAt ?? new Date().toISOString(),
    previewModuleStatuses:      statuses,
    previewModuleTrustExpiresAt: trustExpires,
    previewModuleTrustUsed:     trustUsed,
    previewPaymentSelection:    payable,
    previewQuotedPrice:         calcPreviewPriceRub(chosen, payable, {
      bioHadTest: chosen === 'bio'
        ? bioUserHadTest([...new Set([...allChosen, ...payable])], getGrantedModulesForPaymentSubject(user, chosen))
        : undefined,
    }),
    navHidden,
    previewStatus: 'expired' as PreviewStatus,
  };
}

/** Trust-window истёк — отзываем доступ как при отказе админа. */
export function applyReceiptTrustExpiries(user: any): any {
  if (!user?.receiptClaimedAt) return user;
  const chosen = user.previewChosenSubject;
  if (!chosen) return user;

  const statuses = ensureModuleStatusMap(user, chosen);
  const rawExpires = user.previewModuleTrustExpiresAt;
  const expires: Record<string, string> = rawExpires && typeof rawExpires === 'object'
    ? { ...rawExpires }
    : {};
  const now = Date.now();
  let updated = user;
  let changed = false;

  for (const m of (['questions', 'tests', 'tasks'] as PreviewModule[])) {
    if (statuses[m] !== 'receipt_pending') continue;
    let expIso = expires[m];
    // Повторная заявка без доступа: ждёт решения админа, сама не истекает.
    if (!expIso && isReceiptPendingWithoutTrust(user, chosen, m)) continue;
    if (!expIso && user.receiptClaimedAt) {
      expIso = new Date(Date.parse(user.receiptClaimedAt) + PREVIEW_RECEIPT_TRUST_MS).toISOString();
      expires[m] = expIso;
      changed = true;
    }
    if (!expIso || now <= Date.parse(expIso)) continue;
    const next = rejectPreviewModule(updated, m);
    if (next) {
      updated = next;
      changed = true;
      delete expires[m];
    }
  }

  if (!changed) return user;
  return { ...updated, previewModuleTrustExpiresAt: expires };
}

/** Админ вернул на витрину — студент выбирает заново. */
export function reopenPreviewVitrine(user: any) {
  if (!user) return null;
  const updated: Record<string, any> = {
    ...user,
    previewStatus:        'selecting' as PreviewStatus,
    previewChosenSubject: null,
    previewChosenModules: null,
    previewQuotedPrice:   null,
    previewStartedAt:     null,
    previewExpiredAt:     null,
    previewPickedAt:      null,
    receiptClaimedAt:     null,
    previewActiveMsConsumed: null,
    previewActiveMsByModule:     null,
    previewModuleStatuses:       null,
    previewModuleTrustExpiresAt: null,
    _subjectsBeforePreview: undefined,
  };
  delete updated._catalogBrowse;
  delete updated._adminPaymentOnlyLock;
  delete updated.previewActiveMsConsumed;
  delete updated.previewActiveMsByModule;
  delete updated.previewModuleStatuses;
  delete updated.previewModuleTrustExpiresAt;
  return updated;
}

/** Админ подтвердил один раздел — частичный доступ. */
export function confirmPreviewModule(user: any, module: PreviewModule) {
  const chosen = user?.previewChosenSubject;
  if (!chosen) return null;
  const allChosen = getPreviewChosenModulesForAdmin(user);
  if (!allChosen.includes(module)) return null;

  const statuses: PreviewModuleStatusMap = { ...ensureModuleStatusMap(user, chosen) };
  if (statuses[module] !== 'receipt_pending') {
    if (statuses[module] === 'confirmed') return user;
    return null;
  }
  statuses[module] = 'confirmed';

  const confirmed = allChosen.filter(m => statuses[m] === 'confirmed');
  if (allModulesConfirmed(allChosen, statuses)) {
    return confirmPreviewUser({ ...user, previewModuleStatuses: statuses });
  }

  const subjects = user.subjects && typeof user.subjects === 'object'
    ? { ...user.subjects }
    : createDefaultSubjects();
  subjects[chosen] = true;

  const navHidden = {
    ...(user.navHidden || {}),
    [chosen]: isSameSubjectAddonPreview(user, chosen)
      ? buildSubjectAddonNavHidden(user, chosen, allChosen)
      : buildNavHiddenForPaymentTabs(chosen, allChosen, confirmed),
  };

  const trustExpires = user.previewModuleTrustExpiresAt && typeof user.previewModuleTrustExpiresAt === 'object'
    ? { ...user.previewModuleTrustExpiresAt }
    : {};
  delete trustExpires[module];

  return {
    ...user,
    subjects,
    navHidden,
    previewModuleStatuses:      statuses,
    previewModuleTrustExpiresAt: trustExpires,
    previewStatus:              'expired' as PreviewStatus,
  };
}

/** Админ отказал в подтверждении раздела — вкладка остаётся, внутри оплата. */
export function rejectPreviewModule(user: any, module: PreviewModule) {
  const chosen = user?.previewChosenSubject;
  if (!chosen) return null;
  const allChosen = getPreviewChosenModulesForAdmin(user);
  if (!allChosen.includes(module)) return null;

  const statuses: PreviewModuleStatusMap = { ...ensureModuleStatusMap(user, chosen) };
  if (statuses[module] !== 'receipt_pending') return null;
  statuses[module] = 'rejected';

  const navHidden = {
    ...(user.navHidden || {}),
    [chosen]: isSameSubjectAddonPreview(user, chosen)
      ? buildSubjectAddonNavHidden(user, chosen, allChosen)
      : buildNavHiddenForPaymentTabs(chosen, allChosen, allChosen),
  };

  const hasTrustAccess = allChosen.some(
    m => statuses[m] === 'receipt_pending' || statuses[m] === 'confirmed',
  );
  const subjects = user.subjects && typeof user.subjects === 'object'
    ? { ...user.subjects }
    : createDefaultSubjects();
  if (hasTrustAccess) {
    subjects[chosen] = true;
  } else if (user._subjectsBeforePreview && typeof user._subjectsBeforePreview === 'object') {
    subjects[chosen] = user._subjectsBeforePreview[chosen] === true;
  } else {
    subjects[chosen] = false;
  }

  const trustExpires = user.previewModuleTrustExpiresAt && typeof user.previewModuleTrustExpiresAt === 'object'
    ? { ...user.previewModuleTrustExpiresAt }
    : {};
  delete trustExpires[module];

  let next = {
    ...user,
    subjects,
    previewModuleStatuses: statuses,
    previewModuleTrustExpiresAt: trustExpires,
    navHidden,
    previewStatus: 'expired' as PreviewStatus,
  };
  if (allChosen.every(m => statuses[m] === 'rejected' || statuses[m] === 'awaiting_payment')) {
    next = { ...next, receiptClaimedAt: null };
    next.previewModuleTrustExpiresAt = {};
  }
  return next;
}

export function confirmPreviewUser(user: any) {
  const chosen = user.previewChosenSubject;
  if (!chosen) return null;

  const modules = inferChosenModulesForConfirm(user, chosen);
  if (modules.length === 0) return null;

  const subjects = user._subjectsBeforePreview && typeof user._subjectsBeforePreview === 'object'
    ? { ...user._subjectsBeforePreview }
    : user.subjects && typeof user.subjects === 'object'
      ? { ...user.subjects }
      : createDefaultSubjects();
  subjects[chosen] = true;
  const now = new Date().toISOString();
  const hadSubjectBefore = user._subjectsBeforePreview
    && typeof user._subjectsBeforePreview === 'object'
    && user._subjectsBeforePreview[chosen] === true;
  const baseNavHidden = (user._navHiddenBeforePreview && typeof user._navHiddenBeforePreview === 'object')
    ? user._navHiddenBeforePreview
    : (user.navHidden || {});
  const navHidden = hadSubjectBefore
    ? mergeGrantedModulesOnConfirm(baseNavHidden, chosen, modules)
    : {
      ...(user.navHidden || {}),
      [chosen]: buildNavHiddenForConfirmedPurchase(chosen, modules),
    };

  const updated: Record<string, any> = {
    ...user,
    subjects,
    navHidden,
    previewConfirmedAt:   now,
    paid:                 user.paid === true,
    activatedKey:         user.activatedKey && !String(user.activatedKey).startsWith('promo:')
      ? user.activatedKey
      : (user.activatedKey || 'preview'),
    [`${chosen}_grantedAt`]: now,
    _migrated_subjects:        true,
  };

  delete updated.previewStatus;
  delete updated.previewChosenSubject;
  delete updated.previewChosenModules;
  delete updated.previewStartedAt;
  delete updated.previewExpiredAt;
  delete updated.previewPickedAt;
  delete updated.previewFacultyRecordedAt;
  delete updated.previewQuotedPrice;
  delete updated.receiptClaimedAt;
  delete updated._subjectsBeforePreview;
  delete updated._navHiddenBeforePreview;
  delete updated._previewSnapshotBeforeAddon;
  delete updated._previewStatusBeforeCatalog;
  delete updated._catalogBrowse;
  delete updated._adminPaymentOnlyLock;
  delete updated.previewActiveMsConsumed;
  delete updated.previewActiveMsByModule;
  delete updated.previewModuleStatuses;
  delete updated.previewModuleTrustExpiresAt;

  return updated;
}

/**
 * Админ: открыть доступ сразу — без пробника и экрана оплаты.
 * Сохраняет группу, факультет и выбранные студентом предмет/разделы.
 */
export function adminGrantDirectAccess(user: any): any | null {
  if (!user) return null;

  const studyGroup = user.studyGroup ?? null;
  const facultyId = user.facultyId ?? null;
  const promoCode = user.promoCode ?? null;
  const previewFaculty = user.previewFaculty ?? null;

  const primarySubject = String(user.previewChosenSubject || '').trim();
  const openSubjects = getUserAvailableSubjects(user);
  const grantPlan: { id: string; modules: PreviewModule[] }[] = [];
  const seen = new Set<string>();

  const addSubject = (id: string, modules?: PreviewModule[]) => {
    if (!id || seen.has(id) || !getSubject(id)) return;
    const fromField = modules && modules.length > 0
      ? normalizePreviewModules(modules)
      : inferChosenModulesForConfirm(user, id);
    const finalMods = fromField.length > 0
      ? fromField
      : (['questions', 'tests', 'tasks'] as PreviewModule[]);
    grantPlan.push({ id, modules: finalMods });
    seen.add(id);
  };

  if (primarySubject) {
    addSubject(primarySubject, getPreviewChosenModulesForAdmin(user));
  }
  for (const sid of openSubjects) addSubject(sid);

  if (grantPlan.length === 0) return null;

  const subjects = user.subjects && typeof user.subjects === 'object'
    ? { ...user.subjects }
    : createDefaultSubjects();
  const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
  const now = new Date().toISOString();

  for (const { id, modules } of grantPlan) {
    subjects[id] = true;
    navHidden[id] = buildNavHiddenForConfirmedPurchase(id, modules);
  }

  const updated: Record<string, any> = {
    ...user,
    subjects,
    navHidden,
    studyGroup,
    facultyId,
    promoCode,
    previewFaculty,
    previewConfirmedAt: now,
    paid: true,
    _migrated_subjects: true,
  };

  for (const { id } of grantPlan) {
    if (!updated[`${id}_grantedAt`]) updated[`${id}_grantedAt`] = now;
  }

  if (!updated.activatedKey || String(updated.activatedKey).startsWith('promo:')) {
    updated.activatedKey = updated.activatedKey || 'preview';
  }

  clearPreviewFlowFields(updated);
  delete updated._adminPaymentOnlyLock;
  delete updated._subjectsBeforePreview;
  delete updated._navHiddenBeforePreview;
  delete updated._previewSnapshotBeforeAddon;
  delete updated._previewStatusBeforeCatalog;
  delete updated._catalogBrowse;

  return healExamNavHidden(updated);
}

export function getEffectiveUserSubjects(user: any, tgId?: string | null): string[] {
  if (!user) return [];
  const available = getUserAvailableSubjects(user);
  if (user.previewStatus === 'selecting') {
    // Групповой/подтверждённый доступ сохраняется при витрине (докупка 3-го предмета).
    const hasGroupGrants = user.groupGrants
      && typeof user.groupGrants === 'object'
      && Object.keys(user.groupGrants).length > 0;
    if (
      available.length > 0
      && (
        hasFinalizedPreviewAccess(user)
        || user.paid === true
        || user._catalogBrowse === true
        || hasGroupGrants
      )
    ) {
      return available;
    }
    return [];
  }
  if (user.previewStatus === 'active' && isPreviewExpired(user, Date.now(), tgId)) {
    return available;
  }
  return available;
}

/** Убрать устаревшее авто-скрытие «Проверки готовности» из navHidden (раньше прятали при пробе/оплате). */
export function healExamNavHidden(user: any): any {
  if (!user?.navHidden || typeof user.navHidden !== 'object') return user;
  let changed = false;
  const navHidden: Record<string, string[]> = {};
  for (const [sid, hidden] of Object.entries(user.navHidden as Record<string, string[]>)) {
    if (!Array.isArray(hidden)) continue;
    const next = hidden.filter(t => t !== 'exam');
    if (next.length !== hidden.length) changed = true;
    if (next.length > 0) navHidden[sid] = next;
  }
  return changed ? { ...user, navHidden } : user;
}

/**
 * Пишет производную от переданного user — вызывать под withUserLock
 * (src/lib/userLock.ts) со свежепрочитанным пользователем.
 */
export async function maybeExpirePreviewUser(
  redis: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<any> },
  tgId: string,
  user: any,
): Promise<any> {
  if (!user) return user;

  let updated = applyReceiptTrustExpiries(user);
  if (updated !== user) {
    await redis.set(`user_id:${tgId}`, updated);
    user = updated;
  }

  if (user.previewStatus !== 'active') {
    const chosen = normalizePreviewModules(user.previewChosenModules);
    const statuses = ensureModuleStatusMap(user);
    const hasTrial = chosen.some(m => statuses[m] === 'trial');
    if (!hasTrial) return user;
  }

  updated = applyModuleTrialExpiries(user, tgId);
  if (updated === user) return user;
  await redis.set(`user_id:${tgId}`, updated);
  return updated;
}
