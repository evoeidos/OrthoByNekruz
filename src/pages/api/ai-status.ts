import type { NextApiRequest, NextApiResponse } from 'next';

/** Временный эндпоинт диагностики ИИ-ключей (только для admins). */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  return res.json({
    TIMEWEB_AI_KEY:  process.env.TIMEWEB_AI_KEY  ? `✅ set (${process.env.TIMEWEB_AI_KEY.slice(0, 8)}...)` : '❌ missing',
    GROQ_API_KEY:    process.env.GROQ_API_KEY    ? '✅ set' : '❌ missing',
    GEMINI_API_KEY:  process.env.GEMINI_API_KEY  ? '✅ set' : '❌ missing',
    NODE_ENV:        process.env.NODE_ENV,
  });
}
