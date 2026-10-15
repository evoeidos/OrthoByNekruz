import { loginKrasgmuViaBrowser } from '@/lib/krasgmu/browserLogin';
import { KrasgmuAuthError } from '@/lib/krasgmu/errors';
import { alertAdmin } from '@/lib/alertAdmin';
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
      if (name && val && val !== 'deleted') jar[name] = val;
      else if (name) delete jar[name];
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
 * Запрос, который проходит редиректы сам и собирает cookie с каждого ответа.
 * При redirect: 'follow' fetch отдаёт только последний ответ, и cookie,
 * выставленные на промежуточном 302 (так приходит krasgmu.auth после входа), теряются.
 */
async function fetchCollectingCookies(
  url: string,
  jar: KrasgmuSessionCookies,
  init: { method?: 'GET' | 'POST'; body?: string; referer?: string } = {},
): Promise<FetchResult> {
  let current = url;
  let method = init.method ?? 'GET';
  let body = init.body;
  for (let hop = 0; hop < 8; hop++) {
    const headers = new Headers(browserLikeHeaders());
    headers.set('User-Agent', UA);
    if (init.referer) headers.set('Referer', init.referer);
    else headers.set('sec-fetch-site', 'none');
    if (method === 'POST') {
      headers.set('Origin', BASE);
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    }
    const ck = cookieHeader(jar);
    if (ck) headers.set('Cookie', ck);

    const res = await fetch(current, { method, headers, body, redirect: 'manual' });
    applySetCookie(res, jar);

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return { body: await res.text(), status: res.status, url: current };
  }
  throw new KrasgmuAuthError('Сайт КрасГМУ зациклил редиректы при входе', 'form_changed');
}

/**
 * Вход обычным HTTP-запросом через форму главной страницы: POST на корень сайта
 * с полями login (скрытое, равно логину), user_name и user_pass.
 * null — cookie не выдан без понятной причины (сайт изменился или DDoS-Guard
 * не пустил), тогда вызывающий пробует браузер.
 */
async function loginKrasgmuViaHttp(
  login: string,
  password: string,
): Promise<KrasgmuSessionCookies | null> {
  const jar: KrasgmuSessionCookies = {};
  const home = `${BASE}/`;
  try {
    await fetchCollectingCookies(home, jar);
    const res = await fetchCollectingCookies(home, jar, {
      method: 'POST',
      body: new URLSearchParams({ login, user_name: login, user_pass: password }).toString(),
      referer: home,
    });
    if (isLoginFailurePage(res.body)) {
      throw new KrasgmuAuthError('Неверный логин или пароль', 'invalid_credentials');
    }
  } catch (e) {
    if (e instanceof KrasgmuAuthError) throw e;
    throw new KrasgmuAuthError(
      `Сеть недоступна: ${e instanceof Error ? e.message : 'unknown'}`,
      'network',
    );
  }
  return jar['krasgmu.auth'] ? jar : null;
}

/**
 * Авторизация на krasgmu.ru. Основной путь — обычный HTTP-запрос (около секунды,
 * без лимитов). Сайт за DDoS-Guard, поэтому если вход перестанет выдавать cookie,
 * остаётся запасной путь через Browserless (browserLogin.ts): beforeBrowser
 * резервирует вход из его суточного лимита. Дальше все страницы (расписание,
 * оценки) читаются обычным fetch().
 */
export async function loginKrasgmu(
  login: string,
  password: string,
  beforeBrowser: () => Promise<void>,
): Promise<KrasgmuSessionCookies> {
  const jar = await loginKrasgmuViaHttp(login, password);
  if (jar) return jar;

  console.error('[krasgmu] HTTP login gave no krasgmu.auth cookie — falling back to Browserless');
  alertAdmin(
    'krasgmu:http-login',
    'КрасГМУ: вход без браузера перестал выдавать cookie',
    'Входы идут через Browserless (30 в сутки). Сайт или DDoS-Guard что-то поменял — нужно разобраться.',
  );
  await beforeBrowser();
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

export async function fetchKrasgmuBinary(
  path: string,
  cookies: KrasgmuSessionCookies,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = new Headers();
  headers.set('User-Agent', UA);
  for (const [name, value] of Object.entries(browserLikeHeaders())) headers.set(name, value);
  const ck = cookieHeader(cookies);
  if (ck) headers.set('Cookie', ck);

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new KrasgmuAuthError('Не удалось загрузить файл', 'network');
  }
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

/**
 * false — сессия истекла и нужен перелогин. Сетевой сбой пробрасывается: из-за
 * лежащего krasgmu.ru не стоит тратить вход через Browserless.
 */
export async function validateSession(
  cookies: KrasgmuSessionCookies,
  login: string,
): Promise<boolean> {
  if (!cookies['krasgmu.auth']) return false;
  try {
    const id = deriveStudentId(login);
    await fetchKrasgmuPage(`/index.php?page%5Bcommon%5D=user&id=${id}&cat=student&what=mark`, cookies);
    return true;
  } catch (e) {
    if (e instanceof KrasgmuAuthError && e.code === 'invalid_credentials') return false;
    throw e;
  }
}
