/**
 * Smoke tests for the «Занятия» section: week parity, occurrence resolution,
 * overrides, personal layer and curriculum helpers.
 * Run: npx tsx scripts/verify_schedule.ts
 */
import {
  addDays,
  createEmptyGroupSchedule,
  findNextOccurrence,
  mondayOf,
  normalizeGroupSchedule,
  normalizePersonalSchedule,
  occurrenceKey,
  parityOf,
  resolveDayOccurrences,
  resolveRange,
  weekdayOf,
  type GroupSchedule,
} from '../src/lib/schedule';
import {
  normalizeCurriculumPlan,
  resolveActiveSemester,
  semesterProgressPct,
  summarizeSemester,
  upcomingControls,
} from '../src/lib/curriculum';

let checks = 0;

function assert(cond: boolean, msg: string) {
  checks++;
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// ─── Даты и чередование недель ─────────────────────────────────────────────

const ANCHOR = '2026-09-07'; // понедельник

assert(mondayOf('2026-09-10') === ANCHOR, 'mondayOf возвращает понедельник той же недели');
assert(mondayOf(ANCHOR) === ANCHOR, 'понедельник остаётся собой');
assert(weekdayOf(ANCHOR) === 1, 'понедельник = 1');
assert(weekdayOf('2026-09-13') === 7, 'воскресенье = 7');
assert(addDays(ANCHOR, 7) === '2026-09-14', 'addDays через неделю');

assert(parityOf(ANCHOR, ANCHOR) === 'odd', 'опорная неделя нечётная');
assert(parityOf('2026-09-13', ANCHOR) === 'odd', 'воскресенье остаётся в своей неделе');
assert(parityOf('2026-09-14', ANCHOR) === 'even', 'следующая неделя чётная');
assert(parityOf('2026-09-21', ANCHOR) === 'odd', 'через две недели снова нечётная');
assert(parityOf('2026-08-31', ANCHOR) === 'even', 'неделя до опорной чётная');

// ─── Развёртка сетки в занятия конкретных дат ──────────────────────────────

const schedule: GroupSchedule = {
  ...createEmptyGroupSchedule('stomatology', '208с', 2),
  weekAnchorMonday: ANCHOR,
  lessons: [
    { id: 'l1', weekday: 1, pair: 1, weekParity: 'every', title: 'Ортопедия', kind: 'practice' },
    { id: 'l2', weekday: 1, pair: 2, weekParity: 'odd',   title: 'Микробиология', kind: 'lecture' },
    { id: 'l3', weekday: 1, pair: 3, weekParity: 'even',  title: 'Гистология', kind: 'lab' },
    { id: 'l4', weekday: 2, pair: 1, weekParity: 'every', title: 'Анатомия', kind: 'practice', subgroup: 1 },
    { id: 'l5', weekday: 2, pair: 1, weekParity: 'every', title: 'Анатомия (2 п/г)', kind: 'practice', subgroup: 2 },
  ],
  overrides: [],
};

const oddMonday = resolveDayOccurrences(schedule, ANCHOR);
assert(oddMonday.length === 2, 'в нечётный понедельник две пары');
assert(oddMonday[0].lesson.title === 'Ортопедия', 'сортировка по номеру пары');
assert(oddMonday[1].lesson.title === 'Микробиология', 'нечётная пара попала в нечётную неделю');

const evenMonday = resolveDayOccurrences(schedule, addDays(ANCHOR, 7));
assert(evenMonday.length === 2, 'в чётный понедельник две пары');
assert(evenMonday[1].lesson.title === 'Гистология', 'чётная пара попала в чётную неделю');

assert(oddMonday[0].start === '08:30', 'время первой пары из сетки звонков по умолчанию');
assert(oddMonday[0].key === occurrenceKey(ANCHOR, 'l1'), 'ключ занятия собран из даты и id');

// Подгруппа

const tuesday = addDays(ANCHOR, 1);
assert(resolveDayOccurrences(schedule, tuesday).length === 2, 'без выбора подгруппы видны обе');
assert(
  resolveDayOccurrences(schedule, tuesday, { subgroup: 1 }).length === 1,
  'первая подгруппа видит только свою пару',
);
assert(
  resolveDayOccurrences(schedule, tuesday, { subgroup: 2 })[0].lesson.title === 'Анатомия (2 п/г)',
  'вторая подгруппа видит свою пару',
);

// Скрытие пары студентом

assert(
  resolveDayOccurrences(schedule, ANCHOR, { hidden: ['l1'] }).length === 1,
  'скрытая по lessonId пара пропадает',
);
assert(
  resolveDayOccurrences(schedule, ANCHOR, { hidden: [occurrenceKey(ANCHOR, 'l1')] }).length === 1,
  'скрытая по ключу даты пара пропадает',
);

// ─── Правки на дату ────────────────────────────────────────────────────────

const withOverrides: GroupSchedule = {
  ...schedule,
  overrides: [
    { id: 'o1', date: ANCHOR, kind: 'cancel', lessonId: 'l1', note: 'Преподаватель заболел' },
    {
      id: 'o2',
      date: ANCHOR,
      kind: 'replace',
      lessonId: 'l2',
      lesson: { id: 'l2r', pair: 2, title: 'Фармакология', kind: 'lecture' },
    },
    {
      id: 'o3',
      date: ANCHOR,
      kind: 'add',
      lesson: { id: 'o3l', pair: 5, title: 'Консультация к зачёту', kind: 'consultation' },
    },
  ],
};

const patched = resolveDayOccurrences(withOverrides, ANCHOR);
assert(patched.length === 3, 'отменённая пара остаётся видимой, заменённая подменяется, разовая добавляется');
assert(patched[0].cancelled === true, 'отменённая пара помечена');
assert(patched[0].changeNote === 'Преподаватель заболел', 'пояснение к отмене доходит до UI');
assert(patched[1].lesson.title === 'Фармакология' && patched[1].replaced, 'замена помечена как замена');
assert(patched[2].lesson.title === 'Консультация к зачёту', 'разовое занятие встало по своей паре');
assert(
  resolveDayOccurrences(withOverrides, ANCHOR, { includeCancelled: false }).length === 2,
  'отменённые пары можно не показывать',
);

// ─── Личные занятия ────────────────────────────────────────────────────────

const withExtra = resolveDayOccurrences(schedule, ANCHOR, {
  extras: [
    {
      id: 'my1', weekday: 1, pair: 6, weekParity: 'every',
      title: 'Отработка', kind: 'other', onDate: ANCHOR,
    },
    {
      id: 'my2', weekday: 1, pair: 7, weekParity: 'every',
      title: 'Не в этот день', kind: 'other', onDate: addDays(ANCHOR, 1),
    },
  ],
});
assert(withExtra.length === 3, 'разовое личное занятие видно только в свою дату');
assert(withExtra[2].source === 'personal', 'личное занятие помечено источником');

// ─── Диапазон и ближайшая пара ─────────────────────────────────────────────

const week = resolveRange(schedule, ANCHOR, addDays(ANCHOR, 6));
assert(week.length === 7, 'неделя из семи дней');
assert(week[0].occurrences.length === 2 && week[6].occurrences.length === 0, 'выходной пуст');

const nowBeforeFirst = Date.parse('2026-09-07T00:00:00Z'); // 07:00 по Красноярску
const next = findNextOccurrence(week, nowBeforeFirst);
assert(next?.lesson.title === 'Ортопедия', 'до начала дня ближайшая пара — первая');

const nowAfterFirst = Date.parse('2026-09-07T03:30:00Z'); // 10:30 по Красноярску
assert(
  findNextOccurrence(week, nowAfterFirst)?.lesson.title === 'Микробиология',
  'прошедшая пара пропускается',
);

// ─── Нормализация входа из админки ─────────────────────────────────────────

const normalized = normalizeGroupSchedule({
  facultyId: 'stomatology',
  studyGroup: '208с',
  course: 2,
  raw: {
    academicYear: 'мусор',
    weekAnchorMonday: '2026-09-10', // четверг → должен схлопнуться в понедельник
    lessons: [
      { title: 'Ок', weekday: 99, pair: 42, weekParity: 'что-то' },
      { title: '', weekday: 1, pair: 1 },
      { title: 'Дубль id', id: 'x', weekday: 1, pair: 1 },
      { title: 'Дубль id 2', id: 'x', weekday: 1, pair: 2 },
    ],
    overrides: [
      { date: 'не дата', kind: 'cancel', lessonId: 'l1' },
      { date: '2026-09-07', kind: 'cancel' },
      { date: '2026-09-07', kind: 'cancel', lessonId: 'l1' },
    ],
  },
});

assert(normalized.weekAnchorMonday === ANCHOR, 'опорная дата приводится к понедельнику');
assert(/^\d{4}\/\d{4}$/.test(normalized.academicYear), 'битый учебный год заменён на текущий');
assert(normalized.lessons.length === 3, 'занятие без названия отброшено');
assert(normalized.lessons.every(l => l.weekday >= 1 && l.weekday <= 7), 'день недели зажат в диапазон');
assert(normalized.lessons.every(l => l.pair >= 1 && l.pair <= 8), 'номер пары зажат в диапазон');
assert(new Set(normalized.lessons.map(l => l.id)).size === 3, 'дубли id разведены');
assert(normalized.overrides.length === 1, 'правки без даты и без занятия отброшены');

const personal = normalizePersonalSchedule({
  subgroup: '2',
  notes: { 'k#1': '  заметка  ', 'k#2': '   ' },
  done: ['a', '', 'b'],
  hidden: ['h'],
  extras: [{ title: 'Кружок', pair: 3 }, { title: '' }],
});
assert(personal.subgroup === 2, 'подгруппа приведена к числу');
assert(personal.notes['k#1'] === 'заметка' && !('k#2' in personal.notes), 'пустые заметки отброшены');
assert(personal.done.length === 2, 'пустые отметки отброшены');
assert(personal.extras.length === 1, 'личное занятие без названия отброшено');

// ─── Учебный план ──────────────────────────────────────────────────────────

const plan = normalizeCurriculumPlan('stomatology', 2, {
  academicYear: '2026/2027',
  semesters: [
    {
      semester: 1,
      startsOn: '2026-09-01',
      endsOn: '2027-01-31',
      disciplines: [
        { title: 'Ортопедия', control: 'exam', controlDate: '2027-01-20', hoursLecture: 20, hoursPractice: 40, subjectId: 'ortho' },
        { title: 'Микробиология', control: 'credit', controlDate: '2027-01-10', hoursSelf: 30, subjectId: 'micro' },
        { title: 'Несуществующий предмет', control: 'none', subjectId: 'нет-такого' },
        { title: '', control: 'exam' },
      ],
    },
    { semester: 2, disciplines: [{ title: 'Патанатомия', control: 'exam' }] },
  ],
}, 'admin');

const first = plan.semesters[0];
assert(first.disciplines.length === 3, 'дисциплина без названия отброшена');
assert(first.disciplines[2].subjectId === null, 'несуществующий предмет не привязывается');

const summary = summarizeSemester(first);
assert(summary.disciplines === 3 && summary.exams === 1 && summary.credits === 1, 'сводка семестра');
assert(summary.totalHours === 90, 'часы суммируются по всем видам нагрузки');

assert(resolveActiveSemester(plan, '2026-10-01')?.semester === 1, 'осенью активен первый семестр');
assert(resolveActiveSemester(plan, '2027-04-01')?.semester === 2, 'весной активен второй семестр');

const progress = semesterProgressPct(first, '2026-11-01');
assert(progress !== null && progress > 0 && progress < 100, 'прогресс семестра внутри диапазона');
assert(semesterProgressPct(plan.semesters[1], '2026-11-01') === null, 'без дат прогресс не считается');

const upcoming = upcomingControls(plan, '2026-12-01');
assert(upcoming.length === 2, 'аттестации в будущем попадают в список');
assert(upcoming[0].title === 'Микробиология', 'ближайшая аттестация первая');
assert(upcomingControls(plan, '2027-02-01').length === 0, 'прошедшие аттестации не показываются');

console.log(`OK — ${checks} проверок пройдено`);
