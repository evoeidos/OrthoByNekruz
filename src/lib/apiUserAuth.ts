import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataId } from '@/lib/verifyInitData';
import { getUserAvailableSubjects } from '@/lib/subjects';
import { hasFinalizedPreviewAccess, isPreviewFlowInProgress } from '@/lib/previewStateMachine';

const redis = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

export type ApiUserAuthResult =
  | { ok: true; tgId: string; user: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Проверка initData + наличие аккаунта с доступом к контенту (не гость на витрине). */
export async function verifyApiStudyUser(
  initData: unknown,
  telegramId: unknown,
): Promise<ApiUserAuthResult> {
  if (!BOT_TOKEN) {
    return { ok: false, status: 503, error: 'Сервис временно недоступен' };
  }

  const tgId = String(telegramId ?? '').trim();
  if (!tgId || !initData) {
    return { ok: false, status: 401, error: 'Требуется авторизация' };
  }

  const verifiedId = verifyInitDataId(String(initData), BOT_TOKEN);
  if (!verifiedId || String(verifiedId) !== tgId) {
    return { ok: false, status: 401, error: 'Неверная сессия' };
  }

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
