import * as cheerio from 'cheerio';
import type { KrasgmuGradeRow, KrasgmuScheduleDay, KrasgmuScheduleLesson } from '@/lib/krasgmu/types';

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Парсинг HTML-расписания деканата (legacy PHP-страницы). */
export function parseScheduleHtml(html: string): KrasgmuScheduleDay[] {
  const $ = cheerio.load(html);
  const days: KrasgmuScheduleDay[] = [];

  $('table').each((_, table) => {
    const caption = cleanText($(table).find('caption, th[colspan]').first().text());
    if (!caption && $(table).find('td').length < 3) return;

    const headerRow = $(table).find('tr').first();
    const headers = headerRow.find('th, td').map((__, c) => cleanText($(c).text())).get();
    const looksLikeSchedule =
      headers.some(h => /время|предмет|ауд|преп/i.test(h))
      || caption.toLowerCase().includes('расписан');
    if (!looksLikeSchedule && !caption) return;

    const lessons: KrasgmuScheduleLesson[] = [];
    $(table).find('tr').slice(1).each((__, row) => {
      const cells = $(row).find('td').map((___, c) => cleanText($(c).text())).get();
      if (cells.length < 2) return;
      lessons.push({
        time: cells[0] || '',
        subject: cells[1] || '',
        type: cells[2] || '',
        room: cells[3] || '',
        teacher: cells[4] || '',
      });
    });

    if (lessons.length > 0) {
      days.push({
        date: caption || 'Расписание',
        weekday: '',
        lessons,
      });
    }
  });

  if (days.length === 0) {
    const text = cleanText($('body').text());
    if (text.length > 0 && text.length < 500) {
      days.push({ date: 'Расписание', weekday: '', lessons: [{ time: '', subject: text, type: '', room: '', teacher: '' }] });
    }
  }

  return days;
}

/** Парсинг таблицы успеваемости / оценок. */
export function parseGradesHtml(html: string): KrasgmuGradeRow[] {
  const $ = cheerio.load(html);
  const rows: KrasgmuGradeRow[] = [];

  const tables = $('table.tdata').length > 0 ? $('table.tdata') : $('table');
  tables.each((_, table) => {
    $(table).find('tr').slice(1).each((__, row) => {
      const cells = $(row).find('td').map((___, c) => cleanText($(c).text())).get();
      if (cells.length < 2) return;
      rows.push({
        subject: cells[0] || '',
        grade: cells[1] || '',
        date: cells[2] || '',
        teacher: cells[3] || '',
      });
    });
  });

  return rows;
}
