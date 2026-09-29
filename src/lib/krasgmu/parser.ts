import * as cheerio from 'cheerio';
import type {
  KrasgmuGradeRow,
  KrasgmuProfile,
  KrasgmuScheduleDay,
  KrasgmuScheduleLesson,
  KrasgmuTopicPlanRow,
  KrasgmuUmkdEntry,
} from '@/lib/krasgmu/types';

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Парсинг персональных данных (page[common]=user, без id — сессия резолвит
 * на самого залогиненного студента). ФИО — в '.pagetitle', остальное —
 * в key-value таблице 'table.keyval' («Обучение в КрасГМУ сейчас»).
 */
export function parseProfileHtml(html: string): KrasgmuProfile | null {
  const $ = cheerio.load(html);

  const nameNode = $('.pagetitle').first().clone();
  nameNode.find('span').remove();
  const fullName = cleanText(nameNode.text());
  if (!fullName) return null;

  const info: Record<string, string> = {};
  $('table.keyval tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const label = cleanText($(tds.get(0)).text()).replace(/:$/, '');
    const valueCell = $(tds.get(1)).clone();
    // убираем служебные ссылки вроде "Модуль ДЗ" / "Электронный кабинет студента"
    valueCell.find('a').each((__, a) => {
      const $a = $(a);
      if (/модуль дз|электронный кабинет/i.test($a.text())) $a.remove();
    });
    info[label] = cleanText(valueCell.text());
  });

  const [course, group] = (info['Курс, группа'] || '').split('/').map(cleanText);

  return {
    fullName,
    specialty: info['Направление'] || '',
    course: course || '',
    group: group || '',
    enrollYear: info['Год поступления'] || '',
    gradebook: info['Зачетная книжка'] || '',
    category: info['Категория'] || '',
    status: info['СТАТУС'] || '',
  };
}

/**
 * Парсинг личного расписания (page[org]=dean&cat=schedule, с валидной сессией —
 * автоматически показывает группу студента). Реальная структура — не обычная
 * таблица «время/предмет/ауд/преп», а недельная сетка: строки-разделители дней
 * (<tr class='bgsilver bold'><td colspan='2'>Понедельник</td></tr>) и строки занятий
 * с временем в одной ячейке и предметом+доп.данными во второй.
 */
export function parseScheduleHtml(html: string): KrasgmuScheduleDay[] {
  const $ = cheerio.load(html);
  const days: KrasgmuScheduleDay[] = [];

  const table = $('table.silver.schedule');
  let current: KrasgmuScheduleDay | null = null;

  table.find('tr').each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find('td');

    if (cells.length === 1 && cells.first().attr('colspan')) {
      const weekday = cleanText(cells.first().text());
      current = { date: weekday, weekday, lessons: [] };
      days.push(current);
      return;
    }
    if (!current || cells.length < 2) return;

    const timeCell = $(cells.get(0)).clone();
    timeCell.find('br').replaceWith(' / ');
    const time = cleanText(timeCell.text());

    const contentCell = $(cells.get(1));
    const typePrefix = cleanText(contentCell.find('b').first().text()).replace(/:$/, '');
    const room = cleanText(
      contentCell.find('span.green, span[style*="green"]').first().text(),
    );
    const dates = cleanText(contentCell.find('.scheduletime').first().text());

    const subject = cleanText(
      contentCell
        .contents()
        .filter((__, el) => el.type === 'text')
        .map((__, el) => $(el).text())
        .get()
        .join(' '),
    ).replace(/(ссылка:)?\s*[-–]?\s*$/i, '').trim();

    current.lessons.push({
      time,
      subject: subject || typePrefix || '—',
      type: typePrefix,
      room,
      teacher: '',
      dates: dates || undefined,
    });
  });

  return days;
}

/**
 * Парсинг журнала успеваемости (ответ ajax_journal_year — фрагмент HTML, не полная
 * страница). Каждая строка — одно занятие: дата, тип (лекция/практика), предмет+тема,
 * статус (Явка/Неявка/оценка/Перезачет), преподаватель. У занятий в один день дата
 * стоит только в первой строке (rowspan) — переносим её на последующие.
 */
export function parseGradesHtml(html: string): KrasgmuGradeRow[] {
  const $ = cheerio.load(html);
  const rows: KrasgmuGradeRow[] = [];
  let lastDate = '';

  $('tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('daydivider') || $tr.hasClass('bggray')) return;

    const cells = $tr.find('td');
    if (cells.length < 4) return;

    let idx = 0;
    const first = $(cells.get(0));
    let date = lastDate;
    if (first.hasClass('bgsilver')) {
      date = cleanText(first.text());
      lastDate = date;
      idx = 1;
    }
    if (cells.length - idx < 4) return;

    const kind = cleanText($(cells.get(idx)).text());
    idx += 1;

    const bandCell = $(cells.get(idx));
    if (!bandCell.hasClass('bandname')) return;
    const subjectBold = cleanText(bandCell.find('b').first().text());
    const fullText = cleanText(bandCell.text());
    const topic = subjectBold && fullText.startsWith(subjectBold)
      ? fullText.slice(subjectBold.length).replace(/^\s*-\s*/, '')
      : '';
    idx += 1;

    // Статус занятия — один <td colspan> для "Явка"/"Неявка"/"Перезачет", но
    // отдельная тройка <td> без colspan для числовой оценки (значение в одной
    // из трёх ячеек, обычно средней, две другие пустые) — конкатенируем все три.
    const statusCell = $(cells.get(idx));
    let grade: string;
    if (statusCell.attr('colspan')) {
      grade = cleanText(statusCell.text());
      idx += 1;
    } else {
      grade = cleanText([0, 1, 2].map(o => $(cells.get(idx + o)).text()).join(''));
      idx += 3;
    }

    if (cells.length <= idx) return;
    const teacher = cleanText($(cells.get(idx)).text()).replace(/[●\s]+$/, '');

    rows.push({
      subject: topic ? `${subjectBold} — ${topic}` : (subjectBold || fullText),
      grade,
      date,
      teacher,
      kind,
    });
  });

  return rows;
}

/**
 * Парсинг списка УМКД студента (page[common]=user&id=<id>&cat=student&what=umkd) —
 * плоская таблица 'table.silver' со ссылками на дисциплины. Название дисциплины
 * совпадает по формату с полем subject в расписании — служит ключом для связки.
 * У одной дисциплины может быть несколько umkd_id (разные семестры/когорты).
 */
export function parseUmkdListHtml(html: string): KrasgmuUmkdEntry[] {
  const $ = cheerio.load(html);
  const rows: KrasgmuUmkdEntry[] = [];

  $('table.silver a[href*="umkd_id="]').each((_, a) => {
    const $a = $(a);
    const match = ($a.attr('href') || '').match(/umkd_id=(\d+)/);
    const discipline = cleanText($a.text());
    if (!match || !discipline) return;
    rows.push({ umkdId: match[1], discipline });
  });

  return rows;
}

/**
 * Парсинг тематического плана дисциплины (page[org]=dean&cat=oop&mode=umkd&umkd_id=..
 * &tl_type=<0 лекции|1 практика|10 семинары|5 лаб.работы|...>) — одна таблица со
 * ВСЕМИ темами семестра сразу. № темы — порядковый номер лекции/занятия «по счёту»,
 * с которым сверяем даты из расписания; каждая строка помечена id="tl<tl_id>".
 */
export function parseTopicPlanHtml(html: string): KrasgmuTopicPlanRow[] {
  const $ = cheerio.load(html);
  const rows: KrasgmuTopicPlanRow[] = [];

  $('table.silver tr[id^="tl"]').each((_, tr) => {
    const $tr = $(tr);
    const tlId = ($tr.attr('id') || '').replace(/^tl/, '');
    const cells = $tr.find('td');
    if (!tlId || cells.length < 5) return;

    const seq = parseInt(cleanText($(cells.get(1)).text()), 10);
    if (!Number.isFinite(seq)) return;

    const sectionCell = $(cells.get(2));
    const section = cleanText(sectionCell.find('span').first().text()) || cleanText(sectionCell.text());

    const topicCell = $(cells.get(3));
    const topic = cleanText(topicCell.find('b').first().text()) || cleanText(topicCell.text());

    const hours = cleanText($(cells.get(4)).text());

    rows.push({ tlId, seq, section, topic, hours });
  });

  return rows;
}
