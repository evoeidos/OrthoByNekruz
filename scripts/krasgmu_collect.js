/**
 * Сборщик методичек КрасГМУ. Запускается в консоли браузера (DevTools → Console)
 * на любой странице krasgmu.ru, где ты залогинен. Ничего не меняет на сайте —
 * только читает тематический план и методички «для обучающихся».
 *
 * 1. Открой https://krasgmu.ru/ и войди в личный кабинет.
 * 2. Вставь этот файл в консоль, затем:  await collectAll(JOBS)
 * 3. Когда в консоли появится «готово», выполни:  downloadResult()
 *    Скачается krasgmu-all.json.
 * 4. node scripts/build_lesson_programs.cjs <путь к krasgmu-all.json>
 *
 * JOBS: subjectId — id предмета в приложении, umkdId — номер УМКД на сайте
 * (страница «Обучающимся → УМКД», берём последний по номеру: это набор текущего года),
 * tlType — 1 практические занятия, 5 лабораторные работы.
 */
const JOBS = [
  { subjectId: 'bio',    umkdId: '15654', tlType: 1 },
  { subjectId: 'fizo',   umkdId: '15622', tlType: 1 },
  { subjectId: 'gista',  umkdId: '15655', tlType: 1 },
  { subjectId: 'bioxim', umkdId: '16398', tlType: 5 },
  { subjectId: 'chem',   umkdId: '15619', tlType: 5 },
  { subjectId: 'eng',    umkdId: '15612', tlType: 1 },
  { subjectId: 'micro',  umkdId: '13287', tlType: 1 },
  { subjectId: 'pharma', umkdId: '13316', tlType: 1 },
  { subjectId: 'patan',  umkdId: '13332', tlType: 1 },
  { subjectId: 'patfiz', umkdId: '13271', tlType: 1 },
  { subjectId: 'therapy', umkdId: '7485', tlType: 1 },
  { subjectId: 'ortho',  umkdId: '12084', tlType: 1 },
];

// Разделы методички, которые нужны приложению. Остальное (шапка, хронокарта,
// литература, ситуационные задачи) не сохраняем.
const KEEP = [
  'АННОТАЦИЯ',
  'ИЗОБРАЖЕНИЯ ДЛЯ АННОТАЦИИ',
  'ВОПРОСЫ ПО ТЕМЕ ЗАНЯТИЯ',
  'ТЕСТОВЫЕ ЗАДАНИЯ ПО ТЕМЕ С ЭТАЛОНАМИ ОТВЕТОВ',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const planUrl = (umkdId, tlType) =>
  `/index.php?page%5Borg%5D=dean&cat=oop&mode=umkd&umkd_id=${umkdId}&zaysim_id=0&umkd_page=7|0,1,10,5,3,4&tl_type=${tlType}`;
const metodUrl = tlId =>
  `/index.php?page%5Borg%5D=umkd_metod_tl&tl_id=${tlId}&metod_type=0&metod_class=1`;

window.__krasgmuResults = [];

async function collectJob(job) {
  const planHtml = await fetch(planUrl(job.umkdId, job.tlType)).then(r => r.text());
  const planDoc = new DOMParser().parseFromString(planHtml, 'text/html');
  // Таблицы плана идут по семестрам; подписи «N курс M семестр» — в том же порядке
  const labels = [...planDoc.body.innerText.matchAll(/(\d)\s*курс\s*(\d)\s*семестр/gi)]
    .map(m => ({ course: +m[1], semester: +m[2] }));
  const topics = [];
  [...planDoc.querySelectorAll('table.silver')].forEach((table, ti) => {
    table.querySelectorAll('tr[id^="tl"]').forEach(tr => {
      const c = tr.querySelectorAll('td');
      topics.push({
        tlId: tr.id.slice(2),
        seq: parseInt(c[1].textContent, 10),
        section: c[2].textContent.replace(/\s+/g, ' ').trim(),
        topicHtml: c[3].innerHTML,
        hours: c[4].textContent.trim(),
        ...(labels[ti] || {}),
      });
    });
  });

  let next = 0;
  const worker = async () => {
    while (next < topics.length) {
      const t = topics[next++];
      try {
        const html = await fetch(metodUrl(t.tlId)).then(r => r.text());
        const doc = new DOMParser().parseFromString(html, 'text/html');
        t.title = doc.querySelector('.moduletitle2')?.textContent.replace(/\s+/g, ' ').trim() || '';
        t.chapters = [...doc.querySelectorAll('.modulechapter1 > .modulechapter2')]
          .filter(e => KEEP.includes(e.querySelector(':scope > .modulechaptertitle')?.textContent.trim()))
          .map(e => e.outerHTML);
      } catch (e) {
        console.warn(job.subjectId, t.tlId, e.message);
      }
      await sleep(150); // не нагружаем сайт
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { ...job, collectedAt: new Date().toISOString(), topics };
}

async function collectAll(jobs) {
  window.__krasgmuResults = [];
  for (const job of jobs) {
    console.log('собираю', job.subjectId);
    window.__krasgmuResults.push(await collectJob(job));
  }
  console.log('готово: downloadResult()');
}

function downloadResult() {
  const payload = JSON.stringify({ collectedAt: new Date().toISOString(), results: window.__krasgmuResults });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  a.download = 'krasgmu-all.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
