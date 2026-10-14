// ═══════════════════════════════════════════════════════════════════════════
// src/lib/adminAuth.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// ЕДИНАЯ ПРОВЕРКА ПРАВ АДМИНА ДЛЯ ВСЕХ /api/admin-* РОУТОВ.
//
// Два фактора:
//   1. подпись Telegram initData, внутри которой user.id = ADMIN_TG_ID;
//   2. графический ключ — клиент шлёт цифры точек (например "24586") как
//      `secret`, сервер сверяет с ADMIN_SECRET. В клиентском бандле ключа нет.
// Подпись проверяется первой: подбирать ключ может только сам админ.
//
// Использование в роуте:
//   const auth = verifyAdminRequest(req);
//   if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
//
// ═══════════════════════════════════════════════════════════════════════════

import { timingSafeEqual } from 'crypto';
import type { NextApiRequest } from 'next';
import { verifyInitDataUser } from '@/lib/verifyInitData';

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_TG_ID  = process.env.ADMIN_TG_ID  || '978243325';
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';

export type AdminAuthResult =
  | { ok: true;  tgId: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** Сравнение секретов без утечки времени. */
function secretMatches(provided: string): boolean {
  if (!ADMIN_SECRET || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Секрет и initData берём из тела или из заголовков (multipart-роуты). */
function extractCredentials(req: NextApiRequest): { secret: string; initData: string } {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const headerSecret   = req.headers['x-admin-secret'];
  const headerInitData = req.headers['x-telegram-init-data'];
  return {
    secret: String(
      (typeof body.secret === 'string' ? body.secret : '')
      || (typeof headerSecret === 'string' ? headerSecret : '')
      || '',
    ),
    initData: String(
      (typeof body.initData === 'string' ? body.initData : '')
      || (typeof headerInitData === 'string' ? headerInitData : '')
      || '',
    ),
  };
}

/**
 * Полная проверка: общий секрет + подпись Telegram + совпадение с ADMIN_TG_ID.
 * Ни один admin-* роут не должен полагаться только на секрет.
 */
export function verifyAdminRequest(req: NextApiRequest): AdminAuthResult {
  if (!ADMIN_SECRET) {
    return { ok: false, status: 503, error: 'ADMIN_SECRET не задан на сервере.' };
  }
  if (!BOT_TOKEN) {
    return { ok: false, status: 503, error: 'BOT_TOKEN не задан на сервере.' };
  }

  const { secret, initData } = extractCredentials(req);

  if (!initData) {
    return { ok: false, status: 401, error: 'Нет Telegram initData — открой админку через бота.' };
  }

  const tgUser = verifyInitDataUser(initData, BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== ADMIN_TG_ID) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (!secretMatches(secret)) {
    return { ok: false, status: 401, error: 'Неверный графический ключ' };
  }

  return { ok: true, tgId: String(tgUser.id) };
}
