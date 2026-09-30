import type { AppRedis } from '@/lib/redis';
import { KrasgmuAuthError, loginKrasgmu } from '@/lib/krasgmu/client';
import { KrasgmuConfigError } from '@/lib/krasgmu/crypto';
import { saveBinding } from '@/lib/krasgmu/store';
import { clearUniversityCache } from '@/lib/universityParser';

export type BindUniversityResult =
  | { ok: true; login: string; message: string }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      detail?: string;
    };

export async function bindUniversityAccount(
  redis: AppRedis,
  tgId: string,
  login: string,
  password: string,
): Promise<BindUniversityResult> {
  const loginStr = login.trim();
  const passStr = password;

  if (!loginStr || !passStr) {
    return { ok: false, status: 400, error: 'Укажите логин и пароль' };
  }

  try {
    const cookies = await loginKrasgmu(loginStr, passStr);
    await saveBinding(redis, tgId, loginStr, passStr, cookies);
    // Иначе до 5 минут после переподключения к другому аккаунту могут отдаваться
    // расписание/оценки/профиль предыдущего.
    await clearUniversityCache(redis, tgId);
    return {
      ok: true,
      login: loginStr,
      message: 'Аккаунт КрасГМУ успешно привязан',
    };
  } catch (e) {
    if (e instanceof KrasgmuAuthError) {
      const status = e.code === 'invalid_credentials' ? 400 : 502;
      return { ok: false, status, error: e.message, code: e.code };
    }
    if (e instanceof KrasgmuConfigError) {
      console.error('[bind-university]', e.message);
      return {
        ok: false,
        status: 503,
        error: 'Сервис не настроен: задайте KRASGMU_ENCRYPTION_KEY на сервере',
        code: 'config_missing',
      };
    }
    console.error('[bind-university]', e);
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 500,
      error: 'Не удалось привязать аккаунт',
      code: 'internal_error',
      detail: process.env.NODE_ENV === 'development' ? detail : undefined,
    };
  }
}
