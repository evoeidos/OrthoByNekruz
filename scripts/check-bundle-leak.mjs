// Проверка после `next build`: тексты платного контента из src/data не должны
// попадать в публичные JS-чанки (.next/static). Раньше весь контент уезжал
// в бандл главной страницы из-за require(`../data/${f}`) в клиентском коде.
//
// Берёт по несколько фрагментов вопросов/ответов/определений из каждого JSON
// и ищет их в собранных чанках. Нашёл хоть один — exit 1.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
// LEAK_CHECK_STATIC_DIR — проверить другие чанки (например, скачанные с прода).
const STATIC_DIR = process.env.LEAK_CHECK_STATIC_DIR || path.join(ROOT, '.next', 'static');
const DATA_DIRS = [path.join(ROOT, 'src', 'data'), path.join(ROOT, 'src', 'data', 'programs')];
const SAMPLES_PER_FILE = 15;
// Содержательные поля. Заголовки (title) не берём: это публичный тематический
// план, и названия тем законно встречаются в интерфейсе.
const TEXT_FIELDS = ['answer', 'question', 'definition', 'text'];

function collectJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJs(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** Фрагмент без символов, которые минификатор экранирует по-разному. */
function fragmentOf(value) {
  const text = String(value || '').replace(/[\n\r\t\\"'`]/g, ' ');
  const frag = text.slice(10, 50);
  return frag.trim().length >= 25 ? frag : null;
}

function samplesFromFile(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  // Обход вглубь: в программах кафедр текст лежит в sections[].text.
  const out = [];
  const stack = [data];
  while (stack.length > 0 && out.length < SAMPLES_PER_FILE) {
    const node = stack.shift();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (TEXT_FIELDS.includes(key) && typeof value === 'string') {
          const frag = fragmentOf(value);
          if (frag) out.push(frag);
        } else if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
  }
  return out;
}

const chunks = collectJs(STATIC_DIR);
if (chunks.length === 0) {
  console.error(`Нет чанков в ${STATIC_DIR} — сначала запусти next build.`);
  process.exit(1);
}
const bundle = chunks.map(f => fs.readFileSync(f, 'utf8')).join('\n');

let checked = 0;
const leaks = [];
for (const dir of DATA_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    for (const frag of samplesFromFile(path.join(dir, name))) {
      checked++;
      if (bundle.includes(frag)) leaks.push(`${path.relative(ROOT, path.join(dir, name))}: «${frag.trim()}»`);
    }
  }
}

const totalMb = (Buffer.byteLength(bundle) / 1024 / 1024).toFixed(2);
console.log(`Проверено фрагментов: ${checked}, чанков: ${chunks.length}, объём JS: ${totalMb} МБ`);

if (leaks.length > 0) {
  console.error(`\nКонтент из src/data найден в публичном бандле (${leaks.length}):`);
  for (const leak of leaks.slice(0, 20)) console.error(`  - ${leak}`);
  console.error('\nСкорее всего, клиентский компонент импортирует модуль, который читает JSON из src/data.');
  process.exit(1);
}
console.log('Утечек контента в бандл нет.');
