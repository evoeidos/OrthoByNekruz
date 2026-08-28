import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { buildSubjectCatalog } from '@/lib/subjectCatalog';
import {
  loadPreviewCatalogSettings,
  savePreviewCatalogSettings,
  sanitizePreviewCatalogSettings,
  getEffectivePreviewCatalogState,
} from '@/lib/previewCatalogSettings';

const redis        = createRedisFromEnv();

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
    const { isDemoEnabled, isPaidKeysEnabled, previewCatalog } = req.body ?? {};
    const auth = verifyAdminRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
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
