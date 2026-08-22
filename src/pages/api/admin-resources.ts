// pages/api/admin-resources.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import type { Resource } from './resources';

const redis        = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET       = 'materials';

async function getResources(subjectId: string): Promise<Resource[]> {
  const raw = await redis.get(`resources:${subjectId}`);
  if (Array.isArray(raw)) return raw as Resource[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, subjectId, resource, resourceId, secret } = req.body;

  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!subjectId) return res.status(400).json({ error: 'subjectId required' });

  // ── Список ────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const resources = await getResources(subjectId);
    return res.status(200).json({ ok: true, resources });
  }

  // ── Добавить ──────────────────────────────────────────────────────────────
  if (action === 'add') {
    if (!resource?.title || !resource?.url || !resource?.type) {
      return res.status(400).json({ error: 'title, url, type required' });
    }
    const newResource: Resource = {
      id:          `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type:        resource.type,
      title:       resource.title.trim(),
      url:         resource.url.trim(),
      description: (resource.description || '').trim(),
    };
    const resources = await getResources(subjectId);
    resources.push(newResource);
    await redis.set(`resources:${subjectId}`, resources);
    return res.status(200).json({ ok: true, resource: newResource, resources });
  }

  // ── Удалить ───────────────────────────────────────────────────────────────
  if (action === 'delete') {
    if (!resourceId) return res.status(400).json({ error: 'resourceId required' });
    const resources = await getResources(subjectId);
    const target    = resources.find(r => r.id === resourceId);
    const updated   = resources.filter(r => r.id !== resourceId);
    await redis.set(`resources:${subjectId}`, updated);

    // Удаляем файл из Supabase Storage если он там хранится
    if (target && SUPABASE_URL && SERVICE_KEY) {
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
      if (target.url.startsWith(prefix)) {
        const filePath = target.url.slice(prefix.length);
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
          method:  'DELETE',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ prefixes: [filePath] }),
        }).catch(err => console.error('[admin-resources] Storage delete error:', err));
      }
    }

    return res.status(200).json({ ok: true, resources: updated });
  }

  return res.status(400).json({ error: 'Unknown action. Use: list | add | delete' });
}
