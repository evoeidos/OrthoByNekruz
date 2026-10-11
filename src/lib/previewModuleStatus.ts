import { getSubject } from '@/lib/subjects';
import type { PreviewModule } from '@/lib/previewModules';
import { normalizePreviewModules } from '@/lib/previewModules';

/** Статус одного раздела в воронке пробы → оплаты → подтверждения. */
export type PreviewModuleStatus =
  | 'trial'            // идёт проба (таймер тикает только в этом разделе)
  | 'awaiting_payment' // проба кончилась — нужна оплата
  | 'receipt_pending'  // студент нажал «Скинул — войти», ждёт админа
  | 'confirmed'        // админ подтвердил — полный доступ
  | 'rejected';        // админ отказал — вкладка видна, внутри оплата

export type PreviewModuleStatusMap = Partial<Record<PreviewModule, PreviewModuleStatus>>;

/** Короткие буквы для админки: bio — Т */
export const ADMIN_MODULE_LETTER: Record<PreviewModule, string> = {
  questions: 'В',
  tests:     'Т',
  tasks:     'З',
};

export function formatAdminModuleLabel(subjectId: string, module: PreviewModule): string {
  const cfg = getSubject(subjectId);
  const short = cfg?.shortLabel || subjectId;
  return `${short} — ${ADMIN_MODULE_LETTER[module]}`;
}

export function initModuleStatuses(
  modules: PreviewModule[],
  status: PreviewModuleStatus = 'trial',
): PreviewModuleStatusMap {
  const map: PreviewModuleStatusMap = {};
  for (const m of modules) map[m] = status;
  return map;
}

export function getChosenModulesFromStatuses(
  map: PreviewModuleStatusMap | null | undefined,
): PreviewModule[] {
  if (!map || typeof map !== 'object') return [];
  return (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(m => map[m] != null);
}

export function modulesNeedingAdminAction(
  map: PreviewModuleStatusMap | null | undefined,
): PreviewModule[] {
  if (!map) return [];
  return (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(
    m => map[m] === 'receipt_pending' || map[m] === 'trial',
  );
}

export function modulesAwaitingPayment(
  map: PreviewModuleStatusMap | null | undefined,
): PreviewModule[] {
  if (!map) return [];
  return (['questions', 'tests', 'tasks'] as PreviewModule[]).filter(
    m => map[m] === 'awaiting_payment' || map[m] === 'rejected',
  );
}

export function allModulesConfirmed(
  chosen: PreviewModule[],
  map: PreviewModuleStatusMap | null | undefined,
): boolean {
  if (chosen.length === 0) return false;
  return chosen.every(m => map?.[m] === 'confirmed');
}

export function syncModuleStatusesOnPick(
  chosen: PreviewModule[],
  existing?: PreviewModuleStatusMap | null,
): PreviewModuleStatusMap {
  const map: PreviewModuleStatusMap = {};
  for (const m of chosen) {
    map[m] = existing?.[m] === 'confirmed' ? 'confirmed' : 'trial';
  }
  return map;
}

export function setAllModuleStatuses(
  chosen: PreviewModule[],
  status: PreviewModuleStatus,
  existing?: PreviewModuleStatusMap | null,
): PreviewModuleStatusMap {
  const map: PreviewModuleStatusMap = { ...(existing || {}) };
  for (const m of chosen) {
    if (map[m] !== 'confirmed') map[m] = status;
  }
  return map;
}

export function ensureModuleStatusMap(
  user: any,
  subjectId?: string,
): PreviewModuleStatusMap {
  const existing = user?.previewModuleStatuses;
  if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
    return existing as PreviewModuleStatusMap;
  }
  const chosen = normalizePreviewModules(user?.previewChosenModules);
  const subject = subjectId || user?.previewChosenSubject;
  if (chosen.length === 0 || !subject) return {};

  let defaultStatus: PreviewModuleStatus = 'awaiting_payment';
  if (user?.previewStatus === 'active') defaultStatus = 'trial';
  else if (user?.receiptClaimedAt) {
    defaultStatus = 'receipt_pending';
  }
  return initModuleStatuses(chosen, defaultStatus);
}

export function moduleShowsPaymentEmbed(
  status: PreviewModuleStatus | undefined,
): boolean {
  return status === 'awaiting_payment' || status === 'rejected';
}

export function moduleAllowsDataAccess(
  status: PreviewModuleStatus | undefined,
): boolean {
  if (!status) return true;
  return status === 'trial' || status === 'confirmed' || status === 'receipt_pending';
}

export function moduleShowsContent(
  status: PreviewModuleStatus | undefined,
): boolean {
  return moduleAllowsDataAccess(status);
}

/**
 * Заявка по разделу ждёт админа без временного доступа: час «на доверии»
 * для этого раздела предмета уже был использован (см. claimPreviewReceipt).
 */
export function isReceiptPendingWithoutTrust(user: any, subjectId: string, module: PreviewModule): boolean {
  const used = user?.previewModuleTrustUsed;
  if (!used || typeof used !== 'object' || !used[`${subjectId}:${module}`]) return false;
  const expires = user?.previewModuleTrustExpiresAt;
  return !(expires && typeof expires === 'object' && expires[module]);
}

/** Есть ли у пользователя доступ к данным раздела с учётом заявки без доверия. */
function moduleDataAllowedForUser(
  user: any,
  subjectId: string,
  module: PreviewModule,
  status: PreviewModuleStatus | undefined,
): boolean {
  if (status === 'receipt_pending' && isReceiptPendingWithoutTrust(user, subjectId, module)) {
    return false;
  }
  return moduleAllowsDataAccess(status);
}

/** Доступ к JSON раздела: до отказа админа — отдаём данные при receipt_pending (кроме повторной заявки). */
export function userHasModuleDataAccess(
  user: any,
  subjectId: string,
  dataType: 'questions' | 'tests' | 'tasks' | 'glossary',
): boolean {
  const flowSubject = user?.previewChosenSubject;
  if (!flowSubject || flowSubject !== subjectId) return true;

  const statuses = ensureModuleStatusMap(user, subjectId);
  if (Object.keys(statuses).length === 0) return true;

  if (dataType === 'glossary') {
    return (['questions', 'tests', 'tasks'] as PreviewModule[]).some(
      m => moduleDataAllowedForUser(user, subjectId, m, statuses[m]),
    );
  }

  return moduleDataAllowedForUser(user, subjectId, dataType, statuses[dataType]);
}

/** В воронке оплаты — всегда тянем JSON с сервера (не из кэша). */
export function shouldBustPaymentFlowCache(
  subjectId: string,
  previewChosen: string | null | undefined,
  statuses: PreviewModuleStatusMap,
  previewStatus: string | null | undefined,
): boolean {
  if (!previewChosen || subjectId !== previewChosen) return false;
  if (previewStatus !== 'active' && previewStatus !== 'expired') return false;
  return (['questions', 'tests', 'tasks'] as PreviewModule[]).some(m => {
    const st = statuses[m];
    return st === 'awaiting_payment' || st === 'receipt_pending' || st === 'rejected';
  });
}
