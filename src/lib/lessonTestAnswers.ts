/**
 * Ответы к тестам из методичек занятий.
 *
 * В методичке тесты идут без ключа, но большая часть тех же вопросов лежит
 * в банке тестов предмета (`*_tests.json`) с правильным ответом. Сопоставляем
 * по тексту вопроса и варианта: регистр, «ё», нумерация «1)»/«а)», пробелы и
 * пунктуация не важны. Если совпадение неоднозначно — ответ не ставим.
 */
import type { LessonTest } from '@/lib/curriculum';
import { resolveCorrectOption } from '@/lib/testAnswers';

interface BankTest {
  question?: unknown;
  options?: unknown;
  correct?: unknown;
}

/** Текст вопроса или варианта без нумерации, регистра и знаков препинания. */
export function lessonTestKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    // «1)», «1.», «а)» — но не инициалы: «Р. Кох»
    .replace(/^\s*(?:\d{1,2}\s*[).]|[a-zа-я]\))\s*/u, '')
    .replace(/[^a-zа-я0-9]+/gu, '');
}

/** Вопрос → ключи правильных вариантов (у дублей в банке их может быть несколько). */
type AnswerIndex = Map<string, Set<string>>;

const indexCache = new WeakMap<object, AnswerIndex>();

function buildIndex(bank: unknown[]): AnswerIndex {
  const index: AnswerIndex = new Map();
  for (const item of bank) {
    const t = item as BankTest;
    if (!t || typeof t.question !== 'string' || typeof t.correct !== 'string') continue;
    const options = Array.isArray(t.options) ? t.options.filter((o): o is string => typeof o === 'string') : [];
    const correct = lessonTestKey(resolveCorrectOption({ options, correct: t.correct }));
    const question = lessonTestKey(t.question);
    if (!question || !correct) continue;
    let set = index.get(question);
    if (!set) index.set(question, set = new Set());
    set.add(correct);
  }
  return index;
}

function answerIndex(bank: unknown[]): AnswerIndex {
  let index = indexCache.get(bank);
  if (!index) indexCache.set(bank, index = buildIndex(bank));
  return index;
}

/** Номер правильного варианта для теста из методички или undefined. */
export function findLessonTestAnswer(test: LessonTest, bank: unknown[]): number | undefined {
  const correct = answerIndex(bank).get(lessonTestKey(test.question));
  if (!correct) return undefined;
  const hits = test.options
    .map((o, i) => (correct.has(lessonTestKey(o)) ? i : -1))
    .filter(i => i >= 0);
  return hits.length === 1 ? hits[0] : undefined;
}

/** Тесты занятия с `answer` там, где ответ нашёлся в банке. */
export function attachLessonTestAnswers(tests: LessonTest[], bank: unknown): LessonTest[] {
  if (!Array.isArray(bank)) return tests;
  return tests.map(t => {
    const answer = findLessonTestAnswer(t, bank);
    return answer === undefined ? t : { ...t, answer };
  });
}
