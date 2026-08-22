'use client';

/** Клиентские вызовы /api/web-auth с cookie-сессией. */
export async function webAuth(mode: string, body: Record<string, unknown> = {}) {
  const res = await fetch('/api/web-auth', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function isInsideTelegramWebApp(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as any).Telegram?.WebApp;
  return !!(tg?.initData || tg?.initDataUnsafe?.user?.id);
}

export function applyWebAccountLocal(account: {
  telegramId?: string | null;
}) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('is_authed', 'true');
  localStorage.setItem('auth_via', 'web');
  if (account.telegramId) {
    localStorage.setItem('user_tg_id', String(account.telegramId));
  }
}
