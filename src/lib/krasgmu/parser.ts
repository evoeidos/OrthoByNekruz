import * as cheerio from 'cheerio';
import type { KrasgmuGradeRow, KrasgmuScheduleDay, KrasgmuScheduleLesson } from '@/lib/krasgmu/types';

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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
