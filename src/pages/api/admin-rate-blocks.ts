// pages/api/admin-rate-blocks.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { clearAuthRateLimitsForTgId, tgIdFromRateBlockKey } from '@/lib/authRateLimit';
import { verifyAdminRequest } from '@/lib/adminAuth';

const redis        = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, tgId } = req.body;

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ── Список активных блокировок входа ──────────────────────────────────────
  if (action === 'list') {
    const blocks: { key: string; tgId: string; ttl: number }[] = [];

    for (const pattern of ['block:*', 'catalog_block:*']) {
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 1000 });
        cursor = Number(nextCursor);

        for (const key of keys) {
          const ttl = await redis.ttl(key);
          const tgIdParsed = tgIdFromRateBlockKey(key);
          if (tgIdParsed) {
            blocks.push({ key, tgId: tgIdParsed, ttl });
          }
        }
      } while (cursor !== 0);
    }

    // Объединяем дубли (несколько IP с одним tgId) — берём максимальный TTL
    const byTgId = new Map<string, number>();
    for (const b of blocks) {
      const prev = byTgId.get(b.tgId) ?? 0;
      if (b.ttl > prev) byTgId.set(b.tgId, b.ttl);
    }

    const result = Array.from(byTgId.entries())
      .map(([id, ttl]) => ({ tgId: id, ttl }))
      .sort((a, b) => b.ttl - a.ttl);

    return res.status(200).json({ ok: true, blocks: result });
  }

  // ── Снятие блокировки для конкретного tgId ────────────────────────────────
  if (action === 'clear') {
    if (!tgId) return res.status(400).json({ error: 'tgId required' });

    const deleted = await clearAuthRateLimitsForTgId(redis, String(tgId));

    return res.status(200).json({ ok: true, deleted });
  }

  return res.status(400).json({ error: 'Unknown action. Use: list | clear' });
}
