// pages/api/admin-glossary.ts
// Кастомные записи глоссария хранятся в Redis: glossary_custom:{subjectId} → GlossaryEntry[]
// При запросе type='glossary' в subject-data.ts эти записи мёржатся с JSON-файлом.
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyAdminRequest } from '@/lib/adminAuth';

const redis        = createRedisFromEnv();

export interface GlossaryEntry {
  id:          string;
  term:        string;
  definition:  string;
  image?:      string;
}

function redisKey(subjectId: string) {
  return `glossary_custom:${subjectId}`;
}

async function getEntries(subjectId: string): Promise<GlossaryEntry[]> {
  const raw = await redis.get(redisKey(subjectId));
  if (Array.isArray(raw)) return raw as GlossaryEntry[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, subjectId, entry, entryId } = req.body ?? {};

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!subjectId) return res.status(400).json({ error: 'subjectId required' });

  if (action === 'list') {
    const entries = await getEntries(subjectId);
    return res.status(200).json({ ok: true, entries });
  }

  if (action === 'add') {
    if (!entry?.term?.trim() || !entry?.definition?.trim()) {
      return res.status(400).json({ error: 'term and definition required' });
    }
    const newEntry: GlossaryEntry = {
      id:         `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      term:       String(entry.term).trim(),
      definition: String(entry.definition).trim(),
      image:      entry.image ? String(entry.image).trim() : undefined,
    };
    const entries = await getEntries(subjectId);
    entries.push(newEntry);
    await redis.set(redisKey(subjectId), entries);
    return res.status(200).json({ ok: true, entry: newEntry, entries });
  }

  if (action === 'delete') {
    if (!entryId) return res.status(400).json({ error: 'entryId required' });
    const entries = await getEntries(subjectId);
    const updated = entries.filter(e => e.id !== entryId);
    await redis.set(redisKey(subjectId), updated);
    return res.status(200).json({ ok: true, entries: updated });
  }

  return res.status(400).json({ error: 'Unknown action. Use: list | add | delete' });
}
