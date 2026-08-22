import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { Redis } from '@upstash/redis';

export type WebAccount = {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
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

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const s = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, s, 64).toString('hex');
  return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  try {
    const next = scryptSync(password, salt, 64);
    const prev = Buffer.from(hash, 'hex');
    if (next.length !== prev.length) return false;
    return timingSafeEqual(next, prev);
  } catch {
    return false;
  }
}

export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

export function newAccountId(): string {
  return randomBytes(12).toString('hex');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function getAccountById(redis: Redis, id: string): Promise<WebAccount | null> {
  const raw = await redis.get<WebAccount | string>(accountKey(id));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as WebAccount; } catch { return null; }
  }
  return raw;
}

export async function getAccountByEmail(redis: Redis, email: string): Promise<WebAccount | null> {
  const id = await redis.get<string>(emailKey(email));
  if (!id) return null;
  return getAccountById(redis, String(id));
}

export async function getAccountByTelegramId(redis: Redis, tgId: string): Promise<WebAccount | null> {
  const id = await redis.get<string>(tgKey(tgId));
  if (!id) return null;
  return getAccountById(redis, String(id));
}

export async function saveAccount(redis: Redis, account: WebAccount): Promise<void> {
  await redis.set(accountKey(account.id), account);
  await redis.set(emailKey(account.email), account.id);
  if (account.telegramId) {
    await redis.set(tgKey(account.telegramId), account.id);
  }
}

export async function createAccount(
  redis: Redis,
  email: string,
  password: string,
): Promise<WebAccount> {
  const normalized = normalizeEmail(email);
  const existing = await getAccountByEmail(redis, normalized);
  if (existing) {
    throw new Error('EMAIL_TAKEN');
  }
  const { salt, hash } = hashPassword(password);
  const account: WebAccount = {
    id: newAccountId(),
    email: normalized,
    passwordHash: hash,
    passwordSalt: salt,
    telegramId: null,
    sessionId: newSessionId(),
    createdAt: new Date().toISOString(),
  };
  await saveAccount(redis, account);
  return account;
}

export async function rotateSession(redis: Redis, account: WebAccount): Promise<WebAccount> {
  const updated = { ...account, sessionId: newSessionId() };
  await saveAccount(redis, updated);
  return updated;
}

export async function linkTelegramToAccount(
  redis: Redis,
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
  email: string;
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
