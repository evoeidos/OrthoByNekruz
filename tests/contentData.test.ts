import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCorrectTestOption } from '@/lib/testAnswers';

// Проверка контента в src/data: битый JSON, дубли id, пустые вопросы/ответы
// и тесты, где ключ не совпадает ни с одним вариантом (студент не может
// ответить верно), ловятся до деплоя, а не жалобами студентов.

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

/**
 * Известные тесты без ключа ответа (correct пустой в исходнике). Ответ нужно
 * взять из исходного PDF/методички — выдумывать нельзя. Исправил — убери id.
 */
const KNOWN_TESTS_WITHOUT_ANSWER: Record<string, Array<string | number>> = {
  'gista_tests.json': [138, 152, 163, 404, 405, 407, 409, 581, 603],
  'fizo_tests.json': [786],
};

type Item = Record<string, unknown>;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

const dataFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
const kindOf = (file: string) =>
  /tests(_[a-z]+)?\.json$/.test(file) ? 'tests'
    : /ticket/i.test(file) && !/report/.test(file) ? 'tickets'
    : /glossary/.test(file) ? 'glossary'
    : /questions|tasks/.test(file) ? 'qa'
    : 'other';

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

function duplicateIds(items: Item[]): unknown[] {
  const seen = new Set<string>();
  const dups: unknown[] = [];
  for (const it of items) {
    const id = String(it.id);
    if (seen.has(id)) dups.push(it.id);
    seen.add(id);
  }
  return dups;
}

describe('контент src/data', () => {
  it.each(dataFiles)('%s — валидный JSON', file => {
    expect(() => readJson(file)).not.toThrow();
  });

  it.each(fs.readdirSync(path.join(DATA_DIR, 'programs')).filter(f => f.endsWith('.json')))(
    'programs/%s — валидный JSON',
    file => {
      expect(() => readJson(path.join('programs', file))).not.toThrow();
    },
  );

  const testsFiles = dataFiles.filter(f => kindOf(f) === 'tests');
  it.each(testsFiles)('%s — у каждого теста есть вопрос, варианты и верный ответ', file => {
    const items = readJson(file) as Item[];
    const known = new Set((KNOWN_TESTS_WITHOUT_ANSWER[file] ?? []).map(String));
    const problems: string[] = [];
    for (const t of items) {
      const options = Array.isArray(t.options) ? (t.options as string[]) : [];
      if (!nonEmpty(t.question)) problems.push(`id=${t.id}: пустой вопрос`);
      if (options.length < 2) problems.push(`id=${t.id}: меньше двух вариантов`);
      const answered = typeof t.correct === 'string'
        && options.some(o => isCorrectTestOption(o, t.correct as string));
      if (!answered && !known.has(String(t.id))) {
        problems.push(`id=${t.id}: ключ ${JSON.stringify(t.correct)} не совпадает ни с одним вариантом`);
      }
    }
    expect(duplicateIds(items), 'дубли id').toEqual([]);
    expect(problems).toEqual([]);
  });

  it.each(dataFiles.filter(f => kindOf(f) === 'qa'))('%s — у каждого вопроса есть id, текст и ответ', file => {
    const items = readJson(file) as Item[];
    const problems = items
      .filter(it => it.id === undefined || !nonEmpty(it.question) || !nonEmpty(it.answer))
      .map(it => `id=${it.id}`);
    expect(duplicateIds(items), 'дубли id').toEqual([]);
    expect(problems, 'без id, вопроса или ответа').toEqual([]);
  });

  it.each(dataFiles.filter(f => kindOf(f) === 'tickets'))('%s — в каждом билете вопросы и задача с ответами', file => {
    const tickets = readJson(file) as Item[];
    const problems: string[] = [];
    for (const t of tickets) {
      const questions = Array.isArray(t.questions) ? (t.questions as Item[]) : [];
      const task = t.task as Item | undefined;
      if (questions.length === 0) problems.push(`билет ${t.ticketNumber}: нет вопросов`);
      for (const q of questions) {
        if (!nonEmpty(q.question) || !nonEmpty(q.answer)) problems.push(`билет ${t.ticketNumber}: вопрос без текста/ответа`);
      }
      if (!task || !nonEmpty(task.question) || !nonEmpty(task.answer)) problems.push(`билет ${t.ticketNumber}: задача без текста/ответа`);
    }
    expect(problems).toEqual([]);
  });

  it.each(dataFiles.filter(f => kindOf(f) === 'glossary'))('%s — у каждого термина есть название', file => {
    const items = readJson(file) as Item[];
    expect(items.filter(it => !nonEmpty(it.term)).length).toBe(0);
  });

  it('список известных тестов без ответа не устарел', () => {
    for (const [file, ids] of Object.entries(KNOWN_TESTS_WITHOUT_ANSWER)) {
      const items = readJson(file) as Item[];
      for (const id of ids) {
        const t = items.find(it => String(it.id) === String(id));
        const answered = !!t && typeof t.correct === 'string'
          && (t.options as string[]).some(o => isCorrectTestOption(o, t.correct as string));
        expect(answered, `${file} id=${id} уже исправлен — убери из KNOWN_TESTS_WITHOUT_ANSWER`).toBe(false);
      }
    }
  });
});
