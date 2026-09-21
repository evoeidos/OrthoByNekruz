import * as cheerio from 'cheerio';
import type { KrasgmuSessionCookies } from '@/lib/krasgmu/types';

const BASE = 'https://krasgmu.ru';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class KrasgmuAuthError extends Error {
  constructor(message: string, readonly code: 'invalid_credentials' | 'form_changed' | 'network') {
    super(message);
    this.name = 'KrasgmuAuthError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseSetCookie(header: string | null, jar: KrasgmuSessionCookies): void {
  if (!header) return;
  const parts = header.split(/,(?=[^;]+?=)/);
  for (const part of parts) {
    const seg = part.split(';')[0]?.trim();
    const eq = seg?.indexOf('=');
    if (eq && eq > 0) {
      const name = seg!.slice(0, eq).trim();
      const val = seg!.slice(eq + 1).trim();
      if (name && val) jar[name] = val;
    }
  }
}

function cookieHeader(jar: KrasgmuSessionCookies): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

type FetchResult = { body: string; status: number; url: string };

async function fetchWithCookies(
  url: string,
  jar: KrasgmuSessionCookies,
  init: RequestInit = {},
): Promise<FetchResult> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', UA);
  headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  headers.set('Accept-Language', 'ru-RU,ru;q=0.9,en;q=0.8');
  const ck = cookieHeader(jar);
  if (ck) headers.set('Cookie', ck);

  const res = await fetch(url, { ...init, headers, redirect: 'follow' });
  const setCookie = res.headers.get('set-cookie');
  parseSetCookie(setCookie, jar);

  const body = await res.text();
  return { body, status: res.status, url: res.url };
}

async function fetchRetry(
  url: string,
  jar: KrasgmuSessionCookies,
  init: RequestInit = {},
  attempts = 3,
): Promise<FetchResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithCookies(url, jar, init);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
  }
  throw new KrasgmuAuthError(
    `Сеть недоступна: ${lastErr instanceof Error ? lastErr.message : 'unknown'}`,
    'network',
  );
}

function extractLoginForm(html: string, pageUrl: string): {
  action: string;
  fields: Record<string, string>;
} | null {
  const $ = cheerio.load(html);
  const form = $('form').filter((_, el) => {
    const hasPass = $(el).find('input[type="password"]').length > 0;
    const hasUser = $(el).find('input[name="login"], input[name="user_name"]').length > 0;
    return hasPass && hasUser;
  }).first();

  if (!form.length) return null;

  const action = form.attr('action') || pageUrl;
  const fields: Record<string, string> = {};
  form.find('input').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    const type = ($(el).attr('type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') return;
    fields[name] = $(el).attr('value') || '';
  });
  return { action: new URL(action, pageUrl).href, fields };
}

function isLoginFailurePage(html: string): boolean {
  return /неверный логин/i.test(html) || /неверный пароль/i.test(html);
}

/** Страница деканата без авторизации содержит user_pass; после входа — нет. */
function hasLoginForm(html: string): boolean {
  return /name=['"]user_pass['"]/i.test(html) && /name=['"]user_name['"]/i.test(html);
}

function isLoggedIn(html: string): boolean {
  if (isLoginFailurePage(html)) return false;
  if (hasLoginForm(html)) return false;
  const lower = html.toLowerCase();
  return (
    />\s*выход\s*</i.test(html)
    || /href=[^>]+>\s*выход\s*</i.test(html)
    || (/личный кабинет/i.test(html) && !isLoginFailurePage(html))
  );
}

/**
 * Авторизация на krasgmu.ru.
 * Сначала загружает страницу входа (CSRF/hidden-поля), затем POST с login/user_name/user_pass.
 */
const DEAN_LOGIN_URL = `${BASE}/index.php?page%5Borg%5D=dean`;

export async function loginKrasgmu(
  login: string,
  password: string,
): Promise<KrasgmuSessionCookies> {
  const jar: KrasgmuSessionCookies = {};

  const page = await fetchRetry(DEAN_LOGIN_URL, jar);
  const formInfo = extractLoginForm(page.body, page.url);
  const postUrl = formInfo?.action || DEAN_LOGIN_URL;

  const body = new URLSearchParams(formInfo?.fields ?? {});
  body.set('user_name', login);
  body.set('user_pass', password);
  // name='login' — кнопка «ВХОД», не логин пользователя
  body.set('login', '');

  const res = await fetchRetry(postUrl, jar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (isLoginFailurePage(res.body)) {
    throw new KrasgmuAuthError('Неверный логин или пароль', 'invalid_credentials');
  }
  if (isLoggedIn(res.body)) return jar;

  const cabinet = await fetchRetry(DEAN_LOGIN_URL, jar);
  if (isLoginFailurePage(cabinet.body)) {
    throw new KrasgmuAuthError('Неверный логин или пароль', 'invalid_credentials');
  }
  if (isLoggedIn(cabinet.body)) return jar;

  if (!page.body.includes('user_pass') && !page.body.includes('user_name')) {
    console.error('[krasgmu] Login form not found — site layout may have changed');
    throw new KrasgmuAuthError(
      'Сайт КрасГМУ изменил форму входа. Попробуйте позже.',
      'form_changed',
    );
  }

  throw new KrasgmuAuthError('Неверный логин или пароль', 'invalid_credentials');
}

export async function fetchKrasgmuPage(
  path: string,
  cookies: KrasgmuSessionCookies,
): Promise<string> {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetchRetry(url, { ...cookies }, {});
  if (!isLoggedIn(res.body) && res.body.includes('user_pass')) {
    throw new KrasgmuAuthError('Сессия истекла — войдите снова', 'invalid_credentials');
  }
  return res.body;
}

export async function validateSession(cookies: KrasgmuSessionCookies): Promise<boolean> {
  try {
    const html = await fetchKrasgmuPage('/index.php?page%5Borg%5D=dean', cookies);
    return isLoggedIn(html);
  } catch {
    return false;
  }
}
