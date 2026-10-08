import { KrasgmuAuthError } from '@/lib/krasgmu/errors';
import type { KrasgmuSessionCookies } from '@/lib/krasgmu/types';

const HOME_URL = 'https://krasgmu.ru/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Кликает по первому элементу selector, чей текст точно равен text.
 * Через evaluate (не page.$x/Locator) — устойчиво к смене API puppeteer между версиями.
 */
async function clickByExactText(
  page: import('puppeteer-core').Page,
  selector: string,
  text: string,
): Promise<boolean> {
  const handle = await page.evaluateHandle(
    (sel: string, txt: string) => {
      const els = Array.from(document.querySelectorAll(sel));
      return els.find(el => (el.textContent || '').trim() === txt) ?? null;
    },
    selector,
    text,
  );
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return false;
  }
  await (element as import('puppeteer-core').ElementHandle<Element>).click();
  await handle.dispose();
  return true;
}

/** Полный wss-адрес, либо собирается из токена (стандартный эндпоинт Browserless). */
function browserlessEndpoint(): string {
  if (process.env.BROWSERLESS_WS_ENDPOINT) return process.env.BROWSERLESS_WS_ENDPOINT;
  if (process.env.BROWSERLESS_TOKEN) {
    return `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`;
  }
  return '';
}

/**
 * Вход на krasgmu.ru требует настоящего браузера: сайт за DDoS-Guard, который
 * пропускает обычные GET через fetch(), но POST логина молча игнорирует (200 без
 * ошибки, но без выдачи cookie 'krasgmu.auth'), если TLS/HTTP-отпечаток запроса не
 * похож на реальный Chrome — простым HTTP-клиентом это не обойти (подтверждено
 * побайтовым сравнением заголовков с DevTools).
 *
 * Раньше запускали Chromium локально на сервере (@sparticuz/chromium — сборка без
 * внешних системных библиотек, как для AWS Lambda), но на Timeweb рантайм-образ
 * не наследует системные библиотеки, настроенные для сборки (даже когда libnss3
 * и т.п. явно прописаны в «Зависимостях» приложения) — Chromium падает с
 * "libnss3.so: cannot open shared object file". Root-доступа для apt-get в
 * рантайм-контейнере тоже нет. Поэтому подключаемся к браузеру, который выполняется
 * не у нас на сервере, а в инфраструктуре Browserless — системные библиотеки там
 * не наша забота.
 *
 * После входа возвращаем куки из браузерного контекста — дальше расписание и оценки
 * читаются обычным fetch() (эти GET-запросы DDoS-Guard не блокирует).
 */
export async function loginKrasgmuViaBrowser(
  login: string,
  password: string,
): Promise<KrasgmuSessionCookies> {
  const wsEndpoint = browserlessEndpoint();
  if (!wsEndpoint) {
    throw new KrasgmuAuthError(
      'Удалённый браузер не настроен на сервере (BROWSERLESS_WS_ENDPOINT / BROWSERLESS_TOKEN).',
      'browser_unavailable',
    );
  }

  const mod = await import('puppeteer-core').catch(() => null);
  if (!mod) {
    throw new KrasgmuAuthError(
      'Браузерный движок не установлен на сервере (puppeteer-core).',
      'browser_unavailable',
    );
  }
  const puppeteer = mod.default;

  const browser = await puppeteer
    .connect({ browserWSEndpoint: wsEndpoint })
    .catch((e: unknown) => {
      throw new KrasgmuAuthError(
        `Не удалось подключиться к удалённому браузеру: ${e instanceof Error ? e.message : String(e)}`,
        'browser_unavailable',
      );
    });

  // Browserless может отдавать переиспользуемый браузер — без отдельного контекста
  // куки/сессия одного логина рискуют утечь в другой. Изолированный контекст даёт
  // своё собственное хранилище независимо от того, что было в браузере до нас.
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    await clickByExactText(page, 'button, a', 'Принять').catch(() => false);

    // DDoS-Guard иногда отдаёт промежуточную JS-проверку вместо главной страницы
    // (чаще при повторных заходах подряд с одного IP Browserless) — она сама
    // редиректит на реальную страницу через пару секунд. Пробуем несколько раз,
    // прежде чем считать это сменой вёрстки сайта.
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2500));
      opened = await clickByExactText(page, 'a', 'Войти');
    }
    if (!opened) {
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
      console.error('[krasgmu] "Войти" not found on home page. Body snippet:', bodyText.slice(0, 300));
      throw new KrasgmuAuthError('Не найдена кнопка входа — сайт изменил вёрстку.', 'form_changed');
    }

    await page.waitForSelector('#user_pass', { visible: true, timeout: 10_000 });
    await page.type('#user_name', login, { delay: 15 });
    await page.type('#user_pass', password, { delay: 15 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => null),
      page.keyboard.press('Enter'),
    ]);
    await new Promise(r => setTimeout(r, 1000));

    const cookies = await page.cookies();
    const jar: KrasgmuSessionCookies = {};
    for (const c of cookies) jar[c.name] = c.value;

    if (jar['krasgmu.auth']) return jar;

    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (/неверный логин/i.test(bodyText) || /неверный пароль/i.test(bodyText)) {
      throw new KrasgmuAuthError('Неверный логин или пароль', 'invalid_credentials');
    }
    console.error('[krasgmu] Browser login finished without krasgmu.auth cookie — site may have changed');
    throw new KrasgmuAuthError('Не удалось войти на сайт КрасГМУ. Попробуйте позже.', 'form_changed');
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }
}
