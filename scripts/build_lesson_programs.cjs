/**
 * Собирает планы занятий из методичек КрасГМУ в src/data/programs/.
 *
 * Вход — JSON, который скачивается из залогиненного krasgmu.ru консольным
 * сборщиком (scripts/krasgmu_collect.js): по каждому предмету тематический план
 * практических занятий и нужные разделы методичек «для обучающихся» как сырой HTML.
 * Из методички берём АННОТАЦИЮ (с таблицами и ссылками на изображения), ВОПРОСЫ ПО
 * ТЕМЕ ЗАНЯТИЯ и ТЕСТОВЫЕ ЗАДАНИЯ. Всё остальное — шапку, хронокарту, литературу,
 * задачи — отбрасываем.
 *
 * Запуск:  node scripts/build_lesson_programs.cjs <krasgmu-all.json> [facultyId]
 * Нужен cheerio (есть в node_modules проекта).
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const inputPath = process.argv[2];
const facultyId = process.argv[3] || 'stomatology';
if (!inputPath) {
  console.error('Usage: node scripts/build_lesson_programs.cjs <krasgmu-all.json> [facultyId]');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'programs');
const SEED_FILE = path.join(__dirname, '..', 'src', 'lib', 'curriculumSeed.ts');

const SUBJECT_LABEL = {
  bio: 'Биология', fizo: 'Физиология', gista: 'Гистология', bioxim: 'Биохимия',
  chem: 'Химия', eng: 'Английский язык', micro: 'Микробиология',
  pharma: 'Фармакология', patan: 'Патологическая анатомия',
  patfiz: 'Патологическая физиология', therapy: 'Терапевтическая стоматология',
  ortho: 'Ортопедия',
};
const FACULTY_TITLE = {
  stomatology: 'стоматология', therapeutic: 'лечебное дело', pediatrics: 'педиатрия',
};

const clean = s => String(s || '').replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ')
  .replace(/ *\n */g, '\n').trim();
const oneLine = s => clean(s).replace(/\s+/g, ' ');

function chapterTitle($, el) {
  return oneLine($(el).children('.modulechaptertitle').first().text());
}

/** Узел → блоки текста: абзацы, пункты списков, таблицы. */
function blocksOf($, node, out) {
  $(node).contents().each((_, child) => {
    if (child.type === 'text') {
      const text = oneLine($(child).text());
      if (text) out.push({ type: 'p', text });
      return;
    }
    if (child.type !== 'tag') return;
    const $c = $(child);
    const tag = child.name.toLowerCase();
    if (tag === 'style' || tag === 'script' || tag === 'hr' || tag === 'img') return;
    if (tag === 'table') {
      const rows = [];
      $c.find('tr').each((__, tr) => {
        const cells = $(tr).children('td, th').map((___, td) => oneLine($(td).text())).get();
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (rows.length) out.push({ type: 'table', rows });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      $c.children('li').each((__, li) => {
        const text = oneLine($(li).text());
        if (text) out.push({ type: 'li', text });
      });
      return;
    }
    if (tag === 'br') return;
    const hasBlockChild = $c.children('p, div, table, ul, ol').length > 0;
    if (hasBlockChild) {
      blocksOf($, child, out);
      return;
    }
    // абзац с <br> внутри — это несколько строк
    const html = $c.html() || '';
    const lines = html.split(/<br\s*\/?>/i)
      .map(h => oneLine(cheerio.load(`<x>${h}</x>`)('x').text()))
      .filter(Boolean);
    for (const line of lines) out.push({ type: 'p', text: line });
  });
}

const COMPETENCE = /^Компетенции?\s*:/i;

function parseAnnotation($, el) {
  const blocks = [];
  blocksOf($, el, blocks);
  // первым узлом идёт заголовок раздела — он уже не нужен
  const merged = [];
  for (const b of blocks) {
    if (b.type === 'p' && /^АННОТАЦИЯ$/i.test(b.text)) continue;
    if (b.type === 'p' && COMPETENCE.test(b.text)) continue;
    merged.push(b);
  }
  return merged;
}

function parseImages($, el) {
  const text = $(el).text();
  const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|gif|webp)/gi)].map(m => m[0]);
  $(el).find('img[src]').each((_, img) => urls.push(new URL($(img).attr('src'), 'https://krasgmu.ru/').href));
  return [...new Set(urls)];
}

function stripNumber(s) {
  return oneLine(s).replace(/^\d+\s*[.)]\s*/, '');
}

function parseQuestions($, el) {
  const out = [];
  $(el).children('div').each((_, d) => {
    const $d = $(d);
    if ($d.hasClass('modulechaptertitle')) return;
    const text = oneLine($d.text());
    if (!text || COMPETENCE.test(text)) return;
    if (/^\d+\s*[.)]/.test(text)) out.push(stripNumber(text));
  });
  return out;
}

function parseTests($, el) {
  const out = [];
  let cur = null;
  $(el).children('div').each((_, d) => {
    const $d = $(d);
    if ($d.hasClass('modulechaptertitle')) return;
    const text = oneLine($d.text());
    if (!text || COMPETENCE.test(text)) return;
    const style = ($d.attr('style') || '').replace(/\s+/g, '');
    const isOption = /margin-left/.test(style);
    if (isOption) {
      if (cur) cur.options.push(text.replace(/^\d+\s*[.)]\s*/, '').replace(/[;.]\s*$/, ''));
      return;
    }
    if (/^\d+\s*[.)]/.test(text)) {
      cur = { question: stripNumber(text), options: [] };
      out.push(cur);
    }
  });
  return out.filter(t => t.options.length >= 2);
}

function parseTopic(rawTopic) {
  const $ = cheerio.load(`<div id="r">${rawTopic.topicHtml}</div>`);
  const bold = oneLine($('#r b').first().text());
  return bold;
}

function lessonKind(title) {
  if (/коллоквиум/i.test(title)) return 'colloquium';
  if (/итогов|контрол|зач[её]т|рубежн|модул/i.test(title)) return 'control';
  return 'lesson';
}

function buildLesson(topic, order) {
  const planTitle = parseTopic(topic);
  const metodTitle = oneLine(topic.title).replace(/^Тема\s*№?\s*\d+\s*[.:]?\s*/i, '');
  const title = planTitle || metodTitle || `Тема ${topic.seq}`;

  let annotation; let images; let questions; let tests;
  for (const html of topic.chapters || []) {
    const $ = cheerio.load(html);
    const el = $('.modulechapter2').first();
    const name = chapterTitle($, el);
    if (/^АННОТАЦИЯ$/i.test(name)) annotation = parseAnnotation($, el);
    else if (/ИЗОБРАЖЕНИЯ ДЛЯ АННОТАЦИИ/i.test(name)) images = parseImages($, el);
    else if (/^ВОПРОСЫ ПО ТЕМЕ/i.test(name)) questions = parseQuestions($, el);
    else if (/^ТЕСТОВЫЕ ЗАДАНИЯ/i.test(name)) tests = parseTests($, el);
  }

  const hours = parseFloat(String(topic.hours).replace(',', '.'));
  const lesson = {
    id: `l${topic.seq}`,
    order,
    planNumber: topic.seq,
    kind: lessonKind(title),
    title,
  };
  if (topic.semester) lesson.semester = topic.semester;
  if (Number.isFinite(hours) && hours > 0) lesson.hours = hours;
  if (annotation && annotation.length) lesson.annotation = annotation;
  if (images && images.length) lesson.images = images;
  if (questions && questions.length) lesson.questions = questions;
  if (tests && tests.length) lesson.tests = tests;
  return lesson;
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const jobs = Array.isArray(data) ? data : data.results || [data];
const written = [];

for (const job of jobs) {
  const label = SUBJECT_LABEL[job.subjectId];
  if (!label) { console.warn('skip unknown subject', job.subjectId); continue; }

  const byCourse = new Map();
  for (const t of job.topics) {
    const course = t.course || 1;
    if (!byCourse.has(course)) byCourse.set(course, []);
    byCourse.get(course).push(t);
  }

  for (const [course, topics] of [...byCourse.entries()].sort((a, b) => a[0] - b[0])) {
    topics.sort((a, b) => a.seq - b.seq);
    const lessons = topics.map((t, i) => buildLesson(t, i + 1));
    const id = `${facultyId}:${course}:${job.subjectId}`;
    const program = {
      id,
      facultyId,
      course,
      subjectId: job.subjectId,
      title: `${label}, ${course} курс, ${FACULTY_TITLE[facultyId] || facultyId}`,
      sourceDoc: `Методические указания КрасГМУ для обучающихся, УМКД №${job.umkdId}`,
      lessons,
      lectures: [],
    };
    const file = `${job.subjectId}-${facultyId}-${course}.json`;
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(program) + '\n');
    const withAnno = lessons.filter(l => l.annotation).length;
    const withQ = lessons.filter(l => l.questions).length;
    const withT = lessons.filter(l => l.tests).length;
    console.log(`${file}: ${lessons.length} занятий (аннотация ${withAnno}, вопросы ${withQ}, тесты ${withT})`);
    written.push({ file, subjectId: job.subjectId, course });
  }
}

// Подключаем файлы в curriculumSeed.ts между маркерами
const seed = fs.readFileSync(SEED_FILE, 'utf8');
const START = '// <generated:methodichki>';
const END = '// </generated:methodichki>';
const s = seed.indexOf(START);
const e = seed.indexOf(END);
if (s >= 0 && e > s) {
  const existing = fs.readdirSync(OUT_DIR)
    .filter(f => /^(bio|fizo|gista|bioxim|chem|eng|micro|pharma|patan|patfiz|therapy|ortho)-[a-z]+-\d+\.json$/.test(f))
    .sort();
  // Только имена файлов: curriculumSeed грузит их лениво через import().
  const list = existing.map(f => `  '${f}',`).join('\n');
  const block = `${START}\nconst METHODICHKI_FILES: string[] = [\n${list}\n];\n${END}`;
  const next = seed.slice(0, s) + block + seed.slice(e + END.length);
  fs.writeFileSync(SEED_FILE, next);
  console.log('curriculumSeed.ts обновлён:', existing.length, 'файлов');
} else {
  console.warn('В curriculumSeed.ts нет маркеров <generated:methodichki> — подключи файлы вручную.');
}
