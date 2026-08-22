import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Данные от Telegram Login Widget (data-onauth). */
export type TelegramLoginUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const MAX_AGE_SEC = 86400;

/**
 * Проверка подписи Login Widget:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLoginWidget(
  data: TelegramLoginUser,
  botToken: string,
): boolean {
  try {
    if (!botToken || !data?.id || !data?.hash || !data?.auth_date) return false;
    const authDate = Number(data.auth_date);
    if (!Number.isFinite(authDate)) return false;
    if (Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SEC) return false;

    const { hash, ...rest } = data;
    const checkString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
      .join('\n');

    const secretKey = createHash('sha256').update(botToken).digest();
    const expected = createHmac('sha256', secretKey).update(checkString).digest('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
