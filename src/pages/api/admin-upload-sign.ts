import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyAdminRequest } from '@/lib/adminAuth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET       = 'materials'; // строчные — точно как имя бакета в Supabase

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { filename, contentType } = req.body ?? {};

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!filename || !contentType) return res.status(400).json({ error: 'Missing params' });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const safeName = `${Date.now()}_${String(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  try {
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${safeName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );

    const data = await signRes.json();

    if (!signRes.ok) {
      console.error('[admin-upload-sign] Supabase error:', signRes.status, data);
      return res.status(502).json({ error: data.message || 'Supabase error' });
    }

    // Supabase возвращает signedURL (заглавные), может быть относительным URL
    const rawUrl: string = data.signedURL || data.signedUrl || '';
    const signedUrl = rawUrl.startsWith('http') ? rawUrl : `${SUPABASE_URL}${rawUrl}`;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${safeName}`;

    return res.status(200).json({ signedUrl, publicUrl });
  } catch (err) {
    console.error('[admin-upload-sign]', err);
    return res.status(500).json({ error: String(err) });
  }
}