import { loginKrasgmuViaBrowser } from '@/lib/krasgmu/browserLogin';
import { KrasgmuAuthError } from '@/lib/krasgmu/errors';
import type { KrasgmuSessionCookies } from '@/lib/krasgmu/types';

export { KrasgmuAuthError } from '@/lib/krasgmu/errors';

const BASE = 'https://krasgmu.ru';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Извлекает id студента (число) из логина вида 'z93339' — используется в URL личного кабинета. */
export function deriveStudentId(login: string): string {
  return login.replace(/^\D+/, '');
}

function applySetCookie(res: Response, jar: KrasgmuSessionCookies): void {
  const values = res.headers.getSetCookie?.() ?? [];
  for (const raw of values) {
    const seg = raw.split(';')[0]?.trim();
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

/** Заголовки, похожие на настоящий Chrome — снижает шанс, что DDoS-Guard придирается к обычным GET. */
function browserLikeHeaders(): Record<string, string> {
  return {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
  };
}

async function fetchWithCookies(
  url: string,
  jar: KrasgmuSessionCookies,
  init: RequestInit = {},
): Promise<FetchResult> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', UA);
  for (const [name, value] of Object.entries(browserLikeHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const ck = cookieHeader(jar);
  if (ck) headers.set('Cookie', ck);

  const res = await fetch(url, { ...init, headers, redirect: 'follow' });
  applySetCookie(res, jar);

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

function isLoginFailurePage(html: string): boolean {
  return /неверный логин/i.test(html) || /неверный пароль/i.test(html);
}

/** Появляется на личных страницах, когда сессия не даёт прав на раздел (в т.ч. когда сессия не авторизована). */
function isAccessDeniedPage(html: string): boolean {
  return /недостаточно прав доступа/i.test(html);
}

/**
 * Авторизация на krasgmu.ru.
 * Сайт за DDoS-Guard: обычный fetch()-POST на форму логина принимается с кодом 200,
 * но не выдаёт cookie 'krasgmu.auth' — TLS/HTTP-отпечаток Node не проходит проверку
 * бэкенда для чувствительного действия (подтверждено побайтовым сравнением с DevTools).
 * Поэтому сам вход выполняется через headless-браузер (browserLogin.ts); дальше все
 * страницы (расписание, оценки) читаются обычным fetch() — эти GET DDoS-Guard пропускает.
 */
export async function loginKrasgmu(
  login: string,
  password: string,
): Promise<KrasgmuSessionCookies> {
  return loginKrasgmuViaBrowser(login, password);
}

export async function fetchKrasgmuPage(
  path: string,
  cookies: KrasgmuSessionCookies,
): Promise<string> {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetchRetry(url, { ...cookies }, {});
  if (isLoginFailurePage(res.body) || isAccessDeniedPage(res.body)) {
    throw new KrasgmuAuthError('Сессия истекла — войдите снова', 'invalid_credentials');
  }
  return res.body;
}

export async function validateSession(
  cookies: KrasgmuSessionCookies,
  login: string,
): Promise<boolean> {
  if (!cookies['krasgmu.auth']) return false;
  try {
    const id = deriveStudentId(login);
    await fetchKrasgmuPage(`/index.php?page%5Bcommon%5D=user&id=${id}&cat=student&what=mark`, cookies);
    return true;
  } catch {
    return false;
  }
}
