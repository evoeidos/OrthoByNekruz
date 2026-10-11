import { describe, expect, it } from 'vitest';
import {
  applyReceiptTrustExpiries,
  claimPreviewReceipt,
  confirmPreviewModule,
  getPendingAdminModules,
} from '@/lib/preview';
import { userHasModuleDataAccess } from '@/lib/previewModuleStatus';

/** Проба micro (раздел «вопросы») закончилась — ждёт оплаты. */
function awaitingPaymentUser(subject = 'micro', extra: Record<string, unknown> = {}) {
  return {
    previewChosenSubject: subject,
    previewChosenModules: ['questions'],
    previewStatus: 'expired',
    previewModuleStatuses: { questions: 'awaiting_payment' },
    subjects: {},
    studyGroup: '208с',
    ...extra,
  };
}

/** Срок доверия истёк: имитируем «прошёл час». */
function expireTrust(user: any) {
  return {
    ...user,
    previewModuleTrustExpiresAt: {
      ...user.previewModuleTrustExpiresAt,
      questions: new Date(Date.now() - 1000).toISOString(),
    },
  };
}

describe('«Скинул чек»: час доступа на доверии', () => {
  it('первый чек открывает раздел на час', () => {
    const u = claimPreviewReceipt(awaitingPaymentUser(), ['questions']);
    expect(u.previewModuleStatuses.questions).toBe('receipt_pending');
    expect(u.previewModuleTrustExpiresAt.questions).toBeTruthy();
    expect(userHasModuleDataAccess(u, 'micro', 'questions')).toBe(true);
  });

  it('если админ не подтвердил за час — раздел закрывается', () => {
    const claimed = claimPreviewReceipt(awaitingPaymentUser(), ['questions']);
    const u = applyReceiptTrustExpiries(expireTrust(claimed));
    expect(u.previewModuleStatuses.questions).toBe('rejected');
    expect(userHasModuleDataAccess(u, 'micro', 'questions')).toBe(false);
  });

  it('повторный чек не даёт ещё час: ждёт админа без доступа и без автоотказа', () => {
    const claimed = claimPreviewReceipt(awaitingPaymentUser(), ['questions']);
    const rejected = applyReceiptTrustExpiries(expireTrust(claimed));
    const again = claimPreviewReceipt(rejected, ['questions']);

    expect(again.previewModuleStatuses.questions).toBe('receipt_pending');
    expect(again.previewModuleTrustExpiresAt.questions).toBeUndefined();
    expect(userHasModuleDataAccess(again, 'micro', 'questions')).toBe(false);
    expect(getPendingAdminModules(again)).toContain('questions');

    const muchLater = applyReceiptTrustExpiries({
      ...again,
      receiptClaimedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    });
    expect(muchLater.previewModuleStatuses.questions).toBe('receipt_pending');
  });

  it('админ подтверждает повторную заявку — доступ открыт', () => {
    const claimed = claimPreviewReceipt(awaitingPaymentUser(), ['questions']);
    const again = claimPreviewReceipt(applyReceiptTrustExpiries(expireTrust(claimed)), ['questions']);
    const confirmed = confirmPreviewModule(again, 'questions');
    expect(confirmed).toBeTruthy();
    expect(userHasModuleDataAccess(confirmed, 'micro', 'questions')).toBe(true);
  });

  it('час доверия считается отдельно для каждого предмета', () => {
    const micro = claimPreviewReceipt(awaitingPaymentUser(), ['questions']);
    const pharma = claimPreviewReceipt(
      awaitingPaymentUser('pharma', { previewModuleTrustUsed: micro.previewModuleTrustUsed }),
      ['questions'],
    );
    expect(pharma.previewModuleTrustExpiresAt.questions).toBeTruthy();
  });
});
