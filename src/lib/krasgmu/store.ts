import type { AppRedis } from '@/lib/redis';
import { decryptSecret, encryptSecret } from '@/lib/krasgmu/crypto';
import type { KrasgmuBindingRecord, KrasgmuBindStatus, KrasgmuSessionCookies } from '@/lib/krasgmu/types';

const KEY = (tgId: string) => `krasgmu_bind:${tgId}`;

export async function getBinding(
  redis: AppRedis,
  tgId: string,
): Promise<KrasgmuBindingRecord | null> {
  return redis.get<KrasgmuBindingRecord>(KEY(tgId));
}

export async function getBindStatus(
  redis: AppRedis,
  tgId: string,
): Promise<KrasgmuBindStatus> {
  const rec = await getBinding(redis, tgId);
  if (!rec) return { bound: false };
  return {
    bound: true,
    login: rec.universityLogin,
    boundAt: rec.boundAt,
    lastValidatedAt: rec.lastValidatedAt,
  };
}

export async function saveBinding(
  redis: AppRedis,
  tgId: string,
  login: string,
  password: string,
  cookies: KrasgmuSessionCookies,
): Promise<void> {
  const now = new Date().toISOString();
  const record: KrasgmuBindingRecord = {
    universityLogin: login,
    encryptedSession: encryptSecret(JSON.stringify(cookies)),
    encryptedPassword: encryptSecret(password),
    boundAt: now,
    lastValidatedAt: now,
  };
  await redis.set(KEY(tgId), record);
}

export async function touchValidated(redis: AppRedis, tgId: string): Promise<void> {
  const rec = await getBinding(redis, tgId);
  if (!rec) return;
  rec.lastValidatedAt = new Date().toISOString();
  await redis.set(KEY(tgId), rec);
}

export async function deleteBinding(redis: AppRedis, tgId: string): Promise<void> {
  await redis.del(KEY(tgId));
}

export function loadSessionCookies(rec: KrasgmuBindingRecord): KrasgmuSessionCookies {
  return JSON.parse(decryptSecret(rec.encryptedSession)) as KrasgmuSessionCookies;
}

export function loadPassword(rec: KrasgmuBindingRecord): string {
  return decryptSecret(rec.encryptedPassword);
}
