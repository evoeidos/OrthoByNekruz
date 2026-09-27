import { KrasgmuAuthError } from '@/lib/krasgmu/errors';
import type { KrasgmuSessionCookies } from '@/lib/krasgmu/types';

const HOME_URL = 'https://krasgmu.ru/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Вход на krasgmu.ru требует настоящего браузера: сайт за DDoS-Guard, который
 * пропускает обычные GET через fetch(), но POST логина молча игнорирует (200 без
 * ошибки, но без выдачи cookie 'krasgmu.auth'), если TLS/HTTP-отпечаток запроса не
 * похож на реальный Chrome — простым HTTP-клиентом это не обойти (подтверждено
 * побайтовым сравнением заголовков с DevTools).
 *
 * После входа возвращаем куки из браузерного контекста — дальше расписание и оценки
 * читаются обычным fetch() (эти GET-запросы DDoS-Guard не блокирует).
 */
export async function loginKrasgmuViaBrowser(
  login: string,
  password: string,
): Promise<KrasgmuSessionCookies> {
  const playwright = await import('playwright').catch(() => null);
  if (!playwright) {
    throw new KrasgmuAuthError(
      'Браузерный движок не установлен на сервере (playwright). Выполните `npx playwright install chromium`.',
      'browser_unavailable',
    );
  }

  const browser = await playwright.chromium
    .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    .catch((e: unknown) => {
      throw new KrasgmuAuthError(
        `Не удалось запустить браузер на сервере: ${e instanceof Error ? e.message : String(e)}`,
        'browser_unavailable',
      );
    });

  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'ru-RU' });
    const page = await context.newPage();

    // Публичная главная (Nuxt-фронтенд) — форма входа открывается модалкой по клику
    // «Войти». Старые адреса вида index.php?page[self]=main в новом фронтенде не
    // существуют (показывают "Страница не найдена"), хотя бэкенд у формы тот же.
    await page.goto(HOME_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    const cookieBanner = page.getByText('Принять', { exact: true });
    if (await cookieBanner.count().catch(() => 0)) {
      await cookieBanner.first().click().catch(() => {});
    }

    await page.locator('a', { hasText: 'Войти' }).first().click({ timeout: 10_000 });
    await page.waitForSelector('#user_pass', { state: 'visible', timeout: 10_000 });
    await page.fill('#user_name', login);
    await page.fill('#user_pass', password);

    // Сабмит через Enter, а не клик по кнопке — на странице есть decoy-кнопки
    // с текстом «Войти» вне формы (баннер на главной), клик мог попасть не туда.
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}),
      page.press('#user_pass', 'Enter'),
    ]);
    await page.waitForTimeout(1000);

    const cookies = await context.cookies();
    const jar: KrasgmuSessionCookies = {};
    for (const c of cookies) jar[c.name] = c.value;

    if (jar['krasgmu.auth']) return jar;

    const bodyText = (await page.textContent('body').catch(() => null)) ?? '';
    if (/неверный логин/i.test(bodyText) || /неверный пароль/i.test(bodyText)) {
      throw new KrasgmuAuthError('Неверный логин или пароль', 'invalid_credentials');
    }
    console.error('[krasgmu] Browser login finished without krasgmu.auth cookie — site may have changed');
    throw new KrasgmuAuthError('Не удалось войти на сайт КрасГМУ. Попробуйте позже.', 'form_changed');
  } finally {
    await browser.close();
  }
}
