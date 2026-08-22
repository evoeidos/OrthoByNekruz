import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { buildSubjectCatalog } from '@/lib/subjectCatalog';
import {
  loadPreviewCatalogSettings,
  savePreviewCatalogSettings,
  sanitizePreviewCatalogSettings,
  getEffectivePreviewCatalogState,
} from '@/lib/previewCatalogSettings';

const redis        = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_TG_ID  = '978243325';
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';

function verifyAdmin(initData: string, secret: string): boolean {
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return false;
  if (!BOT_TOKEN) return false;
  const tgUser = verifyInitDataUser(initData, BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== ADMIN_TG_ID) return false;
  return true;
}

async function readSettings() {
  const [isDemoEnabled, isPaidKeysEnabled, previewCatalogRaw] = await Promise.all([
    redis.get('settings:is_demo_enabled'),
    redis.get('settings:is_paid_keys_enabled'),
    loadPreviewCatalogSettings(redis),
  ]);
  const previewCatalogBase = buildSubjectCatalog();
  return {
    isDemoEnabled:           isDemoEnabled ?? true,
    isPaidKeysEnabled:       isPaidKeysEnabled ?? true,
    previewCatalog:          previewCatalogRaw,
    previewCatalogBase,
    previewCatalogEffective: getEffectivePreviewCatalogState(previewCatalogBase, previewCatalogRaw),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // GET — публичный (AuthScreen читает настройки при загрузке)
  if (req.method === 'GET') {
    const settings = await readSettings();
    return res.status(200).json(settings);
  }

  // POST — только админ с валидной initData и секретом
  if (req.method === 'POST') {
    const { initData, secret, isDemoEnabled, isPaidKeysEnabled, previewCatalog } = req.body ?? {};
    if (!initData || !secret || !verifyAdmin(String(initData), String(secret))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (typeof isDemoEnabled !== 'undefined') {
      await redis.set('settings:is_demo_enabled', Boolean(isDemoEnabled));
    }
    if (typeof isPaidKeysEnabled !== 'undefined') {
      await redis.set('settings:is_paid_keys_enabled', Boolean(isPaidKeysEnabled));
    }
    if (typeof previewCatalog !== 'undefined') {
      await savePreviewCatalogSettings(redis, sanitizePreviewCatalogSettings(previewCatalog));
    }
    const settings = await readSettings();
    return res.status(200).json({ success: true, ...settings });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
