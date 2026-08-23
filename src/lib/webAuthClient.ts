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
  if (tg?.initData || tg?.initDataUnsafe?.user?.id) return true;
  // Запасной признак: Telegram кладёт данные запуска в URL hash.
  try {
    const hash = window.location.hash || '';
    if (hash.includes('tgWebAppData') || hash.includes('tgWebAppVersion')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Ждём готовности Telegram WebApp SDK (скрипт может инициализироваться не сразу). */
export async function waitForTelegramWebApp(timeoutMs = 1500): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isInsideTelegramWebApp()) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return isInsideTelegramWebApp();
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
