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

/**
 * Вход на krasgmu.ru требует настоящего браузера: сайт за DDoS-Guard, который
 * пропускает обычные GET через fetch(), но POST логина молча игнорирует (200 без
 * ошибки, но без выдачи cookie 'krasgmu.auth'), если TLS/HTTP-отпечаток запроса не
 * похож на реальный Chrome — простым HTTP-клиентом это не обойти (подтверждено
 * побайтовым сравнением заголовков с DevTools).
 *
 * Используем @sparticuz/chromium — сборка без внешних системных библиотек (та же,
 * что для AWS Lambda), т.к. обычный playwright/puppeteer Chromium на урезанном
 * Docker-образе Timeweb падает с "missing shared libraries" даже после
 * `playwright install-deps` (сборка там идёт не от root, apt недоступен).
 *
 * После входа возвращаем куки из браузерного контекста — дальше расписание и оценки
 * читаются обычным fetch() (эти GET-запросы DDoS-Guard не блокирует).
 */
export async function loginKrasgmuViaBrowser(
  login: string,
  password: string,
): Promise<KrasgmuSessionCookies> {
  const mods = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]).catch(() => null);
  if (!mods) {
    throw new KrasgmuAuthError(
      'Браузерный движок не установлен на сервере (@sparticuz/chromium / puppeteer-core).',
      'browser_unavailable',
    );
  }
  const chromium = mods[0].default;
  const puppeteer = mods[1].default;

  if ('setGraphicsMode' in chromium) {
    (chromium as unknown as { setGraphicsMode: boolean }).setGraphicsMode = false;
  }

  const browser = await puppeteer
    .launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
    .catch((e: unknown) => {
      throw new KrasgmuAuthError(
        `Не удалось запустить браузер на сервере: ${e instanceof Error ? e.message : String(e)}`,
        'browser_unavailable',
      );
    });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    await clickByExactText(page, 'button, a', 'Принять').catch(() => false);

    const opened = await clickByExactText(page, 'a', 'Войти');
    if (!opened) {
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
    await browser.close();
  }
}
