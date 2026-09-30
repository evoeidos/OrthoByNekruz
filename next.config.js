/** @type {import('next').NextConfig} */
const nextConfig = {
  // Отключает сбор трассировки файлов, чтобы обойти баг micromatch
  // (Maximum call stack size exceeded при обходе node_modules на Vercel).
  outputFileTracing: false,
  experimental: {
    // puppeteer-core — клиент для удалённого браузера (Browserless, вход на
    // krasgmu.ru), не должен попадать в webpack-бандл серверных компонентов.
    serverComponentsExternalPackages: ['cheerio', 'puppeteer-core'],
  },
  env: {
    // Хеш коммита текущего деплоя — попадает в клиентский бандл и используется
    // для инвалидации кэша данных предмета (src/lib/subjectData.ts).
    // Vercel выставляет VERCEL_GIT_COMMIT_SHA автоматически на каждом билде;
    // локально (npm run dev) переменной нет — фолбэк на 'dev'.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
};

module.exports = nextConfig;
