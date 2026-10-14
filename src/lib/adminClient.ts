// Клиентские вызовы /api/admin-*: каждый запрос несёт графический ключ
// (secret) и подпись Telegram (initData). Сервер проверяет оба — см.
// src/lib/adminAuth.ts.

export function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

export type AdminResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/** POST в админ-API. Ошибку возвращает текстом сервера — её и показываем. */
export async function adminPost<T = Record<string, unknown>>(
  url: string,
  secret: string,
  body: Record<string, unknown> = {},
): Promise<AdminResult<T>> {
  const initData = getTelegramInitData();
  if (!initData) {
    return { ok: false, status: 401, error: 'Открой админку через Telegram' };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, secret, initData }),
    });
    const data = await r.json().catch(() => ({})) as T & { error?: string };
    if (!r.ok) {
      return { ok: false, status: r.status, error: data.error || `Ошибка сервера (${r.status})` };
    }
    return { ok: true, status: r.status, data };
  } catch {
    return { ok: false, status: 0, error: 'Нет связи с сервером' };
  }
}
