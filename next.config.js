const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * dev-сервер — 'dev'. Сборка — хеш коммита (переменная хостинга или git),
 * а если git на сервере сборки нет — время сборки: значение всё равно
 * меняется на каждом деплое, и кэш у студентов сбрасывается.
 */
function resolveBuildId() {
  if (process.env.NODE_ENV !== 'production') return 'dev';
  const fromEnv = process.env.GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

/**
 * Имена непустых JSON в src/data — для src/lib/subjectCatalog.ts.
 * Раньше каталог проверял файлы через require(`../data/${f}`), а такой
 * require из клиентского кода кладёт ВСЕ JSON предметов в публичный бандл.
 * Список имён считается при сборке, содержимое в бандл не попадает.
 */
function listAvailableDataFiles() {
  const dir = path.join(__dirname, 'src', 'data');
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .filter(name => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (data == null) return false;
        if (Array.isArray(data)) return data.length > 0;
        if (typeof data === 'object') return Object.keys(data).length > 0;
        return true;
      } catch {
        return false;
      }
    })
    .sort()
    .join(',');
}

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
    // Идентификатор сборки — попадает в клиентский бандл и используется
    // для инвалидации кэша данных предмета (src/lib/subjectData.ts).
    // 'dev' включает короткий TTL кэша, поэтому в проде он недопустим.
    NEXT_PUBLIC_BUILD_ID: resolveBuildId(),
    DATA_FILES_AVAILABLE: listAvailableDataFiles(),
  },
};

module.exports = nextConfig;
