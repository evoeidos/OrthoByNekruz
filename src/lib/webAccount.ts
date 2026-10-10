import { randomBytes } from 'crypto';
import type { AppRedis } from '@/lib/redis';

export type WebAccount = {
  id: string;
  // Веб-вход только через Telegram (OIDC). Поля email/пароля остались для
  // совместимости со старыми записями и всегда null у новых аккаунтов.
  email: string | null;
  passwordHash: string | null;
  passwordSalt: string | null;
  telegramId: string | null;
  sessionId: string;
  createdAt: string;
  resetTokenHash?: string | null;
  resetExpiresAt?: number | null;
};

function accountKey(id: string) {
  return `account:${id}`;
}
function emailKey(email: string) {
  return `email_to_account:${normalizeEmail(email)}`;
}
function tgKey(tgId: string) {
  return `tg_to_account:${String(tgId)}`;
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

export function newAccountId(): string {
  return randomBytes(12).toString('hex');
}

export async function getAccountById(redis: AppRedis, id: string): Promise<WebAccount | null> {
  const raw = await redis.get<WebAccount | string>(accountKey(id));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as WebAccount; } catch { return null; }
  }
  return raw;
}

export async function getAccountByTelegramId(redis: AppRedis, tgId: string): Promise<WebAccount | null> {
  const id = await redis.get<string>(tgKey(tgId));
  if (!id) return null;
  return getAccountById(redis, String(id));
}

export async function saveAccount(redis: AppRedis, account: WebAccount): Promise<void> {
  await redis.set(accountKey(account.id), account);
  if (account.email) {
    await redis.set(emailKey(account.email), account.id);
  }
  if (account.telegramId) {
    await redis.set(tgKey(account.telegramId), account.id);
  }
}

/** Аккаунт по входу через Telegram OIDC — без email/пароля, telegramId уже проверен. */
export async function createTelegramAccount(
  redis: AppRedis,
  telegramId: string,
): Promise<WebAccount> {
  const tg = String(telegramId).trim();
  const existing = await getAccountByTelegramId(redis, tg);
  if (existing) return existing;
  const account: WebAccount = {
    id: newAccountId(),
    email: null,
    passwordHash: null,
    passwordSalt: null,
    telegramId: tg,
    sessionId: newSessionId(),
    createdAt: new Date().toISOString(),
  };
  await saveAccount(redis, account);
  return account;
}

export async function rotateSession(redis: AppRedis, account: WebAccount): Promise<WebAccount> {
  const updated = { ...account, sessionId: newSessionId() };
  await saveAccount(redis, updated);
  return updated;
}

export async function linkTelegramToAccount(
  redis: AppRedis,
  account: WebAccount,
  telegramId: string,
): Promise<WebAccount> {
  const tg = String(telegramId).trim();
  const other = await getAccountByTelegramId(redis, tg);
  if (other && other.id !== account.id) {
    throw new Error('TG_TAKEN');
  }
  if (account.telegramId && account.telegramId !== tg) {
    await redis.del(tgKey(account.telegramId));
  }
  const updated: WebAccount = { ...account, telegramId: tg };
  await saveAccount(redis, updated);
  return updated;
}

export type PublicAccount = {
  id: string;
  email: string | null;
  telegramId: string | null;
  needsTelegramLink: boolean;
};

export function toPublicAccount(account: WebAccount): PublicAccount {
  return {
    id: account.id,
    email: account.email,
    telegramId: account.telegramId,
    needsTelegramLink: !account.telegramId,
  };
}
