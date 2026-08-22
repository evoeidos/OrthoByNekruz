import { createRedisFromEnv } from '@/lib/redis';
import { getUserAvailableSubjects } from '@/lib/subjects';
import { hasFinalizedPreviewAccess, isPreviewFlowInProgress } from '@/lib/previewStateMachine';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';
import type { NextApiRequest } from 'next';

const redis = createRedisFromEnv();

export type ApiUserAuthResult =
  | { ok: true; tgId: string; user: Record<string, unknown> }
  | { ok: false; status: number; error: string; code?: string };

type VerifyOpts = {
  req?: NextApiRequest | null;
  cookieHeader?: string | null;
};

/** Проверка initData или веб-сессии + пользователь с доступом к контенту. */
export async function verifyApiStudyUser(
  initData: unknown,
  telegramId: unknown,
  opts?: VerifyOpts,
): Promise<ApiUserAuthResult> {
  const identity = await resolveRequestIdentity(redis, opts?.req ?? null, {
    telegramId,
    initData,
    requireTelegram: true,
    cookieHeader: opts?.cookieHeader,
  });
  if (!identity.ok) {
    return {
      ok: false,
      status: identity.status,
      error: identity.error,
      code: identity.code,
    };
  }

  const tgId = identity.tgId;
  const user = await redis.get<Record<string, unknown>>(`user_id:${tgId}`);
  if (!user || user.blocked === true) {
    return { ok: false, status: 403, error: 'Доступ запрещён' };
  }

  if (!userHasStudyContentAccess(user)) {
    return { ok: false, status: 403, error: 'Сначала открой доступ к предмету' };
  }

  return { ok: true, tgId, user };
}

function userHasStudyContentAccess(user: Record<string, unknown>): boolean {
  if (hasFinalizedPreviewAccess(user)) return true;
  if (user.paid === true) return true;
  if (String(user.activatedKey || '').trim().length >= 8) return true;
  if (getUserAvailableSubjects(user).length > 0) return true;
  if (isPreviewFlowInProgress(user)) return true;
  return user.previewStatus === 'active' || user.previewStatus === 'expired';
}
