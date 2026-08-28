import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyAdminRequest } from '@/lib/adminAuth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET       = 'materials';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const filename    = decodeURIComponent(req.headers['x-filename'] as string ?? '');
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  // bodyParser отключён — секрет и initData приходят заголовками (см. adminAuth).
  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!filename) return res.status(400).json({ error: 'Missing x-filename header' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${safeName}`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  String(contentType),
          'x-upsert':      'false',
        },
        body: buffer,
      },
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      console.error('[admin-upload] Supabase error:', uploadRes.status, text);
      return res.status(502).json({ error: 'Upload failed', detail: text });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${safeName}`;
    return res.status(200).json({ publicUrl });
  } catch (err) {
    console.error('[admin-upload]', err);
    return res.status(500).json({ error: String(err) });
  }
}