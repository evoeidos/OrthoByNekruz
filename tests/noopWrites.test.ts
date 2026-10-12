import { describe, expect, it } from 'vitest';
import { applyGroupAccessToUser } from '@/lib/groupAccess';
import { claimPreviewReceipt, computePreviewExpiry } from '@/lib/preview';

// Чтение не должно превращаться в запись: subject-data и вход берут блокировку
// пользователя и пишут в Redis только когда объект действительно изменился.
// Раньше applyGroupAccessToUser всегда отвечал «изменилось», и каждый запрос
// контента перезаписывал пользователя — запросы упирались в таймаут блокировки.

const settledUser = () => ({
  facultyId: 'stomatology',
  studyGroup: '208с',
  subjects: { ortho: true, micro: false },
  navHidden: {},
  previewStatus: 'confirmed',
});

describe('без изменений — без записи', () => {
  it('групповой доступ: повторное применение возвращает тот же объект', () => {
    const first = applyGroupAccessToUser(settledUser(), []);
    const second = applyGroupAccessToUser(first.user, []);
    expect(second.changed).toBe(false);
    expect(second.user).toBe(first.user);
  });

  it('групповой доступ: заблокированный пользователь не трогается', () => {
    const blocked = { ...settledUser(), blocked: true };
    const res = applyGroupAccessToUser(blocked, []);
    expect(res.changed).toBe(false);
    expect(res.user).toBe(blocked);
  });

  it('истечение пробы: ничего не истекло — тот же объект', () => {
    const user = settledUser();
    expect(computePreviewExpiry(user, '123')).toBe(user);
  });

  it('истечение пробы: час доверия прошёл — новый объект с отказом', () => {
    const claimed = claimPreviewReceipt({
      previewChosenSubject: 'micro',
      previewChosenModules: ['questions'],
      previewStatus: 'expired',
      previewModuleStatuses: { questions: 'awaiting_payment' },
      subjects: {},
      studyGroup: '208с',
    }, ['questions']);
    const expired = {
      ...claimed,
      previewModuleTrustExpiresAt: { questions: new Date(Date.now() - 1000).toISOString() },
    };
    const next = computePreviewExpiry(expired, '123');
    expect(next).not.toBe(expired);
    expect(next.previewModuleStatuses.questions).toBe('rejected');
  });
});
