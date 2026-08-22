/**
 * Отправка письма. Resend при наличии RESEND_API_KEY, иначе лог в консоль (dev).
 */
export async function sendAppEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; logged?: boolean }> {
  const key = process.env.RESEND_API_KEY || '';
  const from = process.env.EMAIL_FROM || 'ByNekruz <onboarding@resend.dev>';

  if (!key) {
    console.warn('[mail] RESEND_API_KEY missing — email logged only');
    console.warn('[mail]', { to: opts.to, subject: opts.subject, text: opts.text });
    return { ok: true, logged: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      console.error('[mail] resend failed', res.status, await res.text());
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[mail] send error', e);
    return { ok: false };
  }
}
