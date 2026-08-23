import dns from 'node:dns';

// На части хостингов (в т.ч. РФ) исходящие соединения к api.telegram.org
// зависают из-за неисправного IPv6. Ставим приоритет IPv4 один раз при старте.
let ipv4Applied = false;
function ensureIpv4First() {
  if (ipv4Applied) return;
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    /* старые версии Node — игнорируем */
  }
  ipv4Applied = true;
}

/**
 * Базовый URL Telegram Bot API. По умолчанию официальный домен.
 * Если сервер не может достучаться до api.telegram.org (блокировка исходящих),
 * задайте TELEGRAM_API_BASE = URL прокси (например, Cloudflare Worker),
 * который проксирует запросы на https://api.telegram.org.
 */
export function getTelegramApiBase(): string {
  const raw = process.env.TELEGRAM_API_BASE?.trim();
  const base = raw && raw.length > 0 ? raw : 'https://api.telegram.org';
  return base.replace(/\/+$/, '');
}

export function botToken(): string {
  return process.env.BOT_TOKEN || '';
}

export type TgResult<T = any> = {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
};

/** Вызов метода Bot API с таймаутом и приоритетом IPv4. */
export async function tgCall<T = any>(
  method: string,
  params?: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<TgResult<T>> {
  ensureIpv4First();
  const token = botToken();
  if (!token) {
    return { ok: false, status: 0, data: null, error: 'BOT_TOKEN missing' };
  }

  const url = `${getTelegramApiBase()}/bot${token}/${method}`;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: params ? 'POST' : 'GET',
      headers: params ? { 'Content-Type': 'application/json' } : undefined,
      body: params ? JSON.stringify(params) : undefined,
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    return {
      ok: res.ok && data?.ok !== false,
      status: res.status,
      data: (data?.result ?? data) as T,
      error: data?.description,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: String(e instanceof Error ? e.message : e),
    };
  } finally {
    clearTimeout(timer);
  }
}
