// pages/api/resources.ts  — публичный эндпоинт, без авторизации
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';

const redis = createRedisFromEnv();

export interface Resource {
  id:          string;
  type:        'link' | 'pdf' | 'docx' | 'pptx' | 'video' | 'umkd';
  title:       string;
  url:         string;
  description: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { subject } = req.query;
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ error: 'subject required' });
  }

  const raw = await redis.get(`resources:${subject}`);
  let resources: Resource[] = [];
  if (Array.isArray(raw)) {
    resources = raw as Resource[];
  } else if (typeof raw === 'string') {
    try { resources = JSON.parse(raw); } catch { resources = []; }
  }

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  return res.status(200).json({ resources });
}
