// pages/api/admin-related-terms.ts
// Управление relatedTerms для вопросов, тестов и задач из админки.
// Данные хранятся в Redis: relatedTerms:{subjectId}:{type} → Record<itemId, string[]>
// subject-data.ts мёржит эти оверрайды при отдаче данных студентам.
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { getSubject } from '@/lib/subjects';
import { loadDataFile } from '@/lib/dataFiles';
import { verifyAdminRequest } from '@/lib/adminAuth';

const redis        = createRedisFromEnv();

type SectionType = 'questions' | 'tests' | 'tasks';

function redisKey(subjectId: string, type: SectionType) {
  return `relatedTerms:${subjectId}:${type}`;
}

function getFileName(subjectId: string, type: SectionType): string | null {
  const cfg = getSubject(subjectId);
  if (!cfg) return null;
  switch (type) {
    case 'questions': return cfg.questionsFile;
    case 'tests':     return cfg.testsFile;
    case 'tasks':     return cfg.tasksFile;
  }
}

async function loadFile(fileName: string): Promise<unknown[] | null> {
  const data = await loadDataFile(fileName);
  return Array.isArray(data) ? data : null;
}

// Strips markdown bold/italic markers and returns first N chars
function preview(text: string, max = 80): string {
  return text.replace(/[*_`#>~]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function getOverrides(subjectId: string, type: SectionType): Promise<Record<string, string[]>> {
  const raw = await redis.get(redisKey(subjectId, type));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string[]>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, subjectId, type, itemId, terms } = req.body ?? {};

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const sectionType = type as SectionType;
  if (!['questions', 'tests', 'tasks'].includes(sectionType)) {
    return res.status(400).json({ error: 'type must be questions|tests|tasks' });
  }

  if (!subjectId) return res.status(400).json({ error: 'subjectId required' });

  // ── Загрузить список элементов (id + preview) ─────────────────────────────
  if (action === 'load_items') {
    const fileName = getFileName(subjectId, sectionType);
    if (!fileName) return res.status(400).json({ error: 'Unknown subject' });

    const data = await loadFile(fileName);
    if (!data) return res.status(404).json({ error: 'Data file not found' });

    const overrides = await getOverrides(subjectId, sectionType);

    const items = data.map((item: any) => ({
      id:           String(item.id),
      preview:      preview(String(item.question ?? '')),
      relatedTerms: overrides[String(item.id)] ?? [
        ...((item.related_glossary as string[] | undefined) ?? []),
        ...((item.relatedTerms as string[] | undefined) ?? []),
      ],
    }));

    return res.status(200).json({ ok: true, items });
  }

  // ── Сохранить relatedTerms для конкретного элемента ───────────────────────
  if (action === 'set_terms') {
    if (!itemId) return res.status(400).json({ error: 'itemId required' });
    if (!Array.isArray(terms)) return res.status(400).json({ error: 'terms must be array' });

    const cleanTerms = (terms as unknown[])
      .map(t => String(t).trim())
      .filter(Boolean);

    const overrides = await getOverrides(subjectId, sectionType);

    if (cleanTerms.length === 0) {
      delete overrides[String(itemId)];
    } else {
      overrides[String(itemId)] = cleanTerms;
    }

    await redis.set(redisKey(subjectId, sectionType), overrides);
    return res.status(200).json({ ok: true, terms: cleanTerms });
  }

  return res.status(400).json({ error: 'Unknown action. Use: load_items | set_terms' });
}
