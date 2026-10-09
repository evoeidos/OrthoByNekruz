const { execSync } = require('child_process');

// Хеш коммита текущего деплоя. Если git при сборке недоступен — время сборки:
// важно лишь, чтобы значение менялось с каждым деплоем.
function buildId() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return String(Date.now());
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Отключает сбор трассировки файлов, чтобы обойти баг micromatch
  // (Maximum call stack size exceeded при обходе node_modules).
  outputFileTracing: false,
  experimental: {
    // puppeteer-core — клиент для удалённого браузера (Browserless, вход на
    // krasgmu.ru), не должен попадать в webpack-бандл серверных компонентов.
    serverComponentsExternalPackages: ['cheerio', 'puppeteer-core'],
  },
  env: {
    // Попадает в клиентский бандл и используется для инвалидации кэша данных
    // предмета (src/lib/subjectData.ts). В npm run dev — 'dev' с коротким TTL.
    NEXT_PUBLIC_BUILD_ID: process.env.NODE_ENV === 'production' ? buildId() : 'dev',
  },
};

module.exports = nextConfig;
