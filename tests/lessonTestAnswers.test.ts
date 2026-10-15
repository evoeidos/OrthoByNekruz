import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachLessonTestAnswers, findLessonTestAnswer } from '@/lib/lessonTestAnswers';

// Ответы к тестам методичек подтягиваются из банка тестов предмета по тексту.

describe('findLessonTestAnswer', () => {
  const bank = [
    {
      question: 'БАКТЕРИОЛОГИЧЕСКИЙ МЕТОД РАЗРАБОТАЛ И ВВЁЛ',
      options: ['1)\tА. ван Левенгук', '2)\tР. Кох', '3)\tЛ. Пастер'],
      correct: '2)\tР. Кох',
    },
    {
      question: 'ЗУБЫ - ОРГАНЫ, ПРЕДНАЗНАЧЕННЫЕ ДЛЯ',
      options: ['а) раздробления пищи', 'б) красоты'],
      correct: 'а) раздробления пищи',
    },
    { question: 'ТОЛЬКО НОМЕР В КЛЮЧЕ', options: ['1) один', '2) два'], correct: '2)' },
    { question: 'ДУБЛЬ С РАЗНЫМ КЛЮЧОМ', options: ['1) да', '2) нет'], correct: '1) да' },
    { question: 'ДУБЛЬ С РАЗНЫМ КЛЮЧОМ', options: ['1) да', '2) нет'], correct: '2) нет' },
  ];

  it('сопоставляет без нумерации, регистра, «ё» и пунктуации', () => {
    expect(findLessonTestAnswer({
      question: 'Бактериологический метод разработал и ввел:',
      options: ['А. Ван Левенгук', 'Л. Пастер', 'Р. Кох'],
    }, bank)).toBe(2);
    expect(findLessonTestAnswer({
      question: 'Зубы — органы, предназначенные для',
      options: ['красоты', 'раздробления пищи'],
    }, bank)).toBe(1);
  });

  it('понимает ключ из одного номера', () => {
    expect(findLessonTestAnswer({ question: 'Только номер в ключе', options: ['два', 'один'] }, bank)).toBe(0);
  });

  it('не ставит ответ, если вопроса нет или совпадение неоднозначно', () => {
    expect(findLessonTestAnswer({ question: 'Другой вопрос', options: ['да', 'нет'] }, bank)).toBeUndefined();
    expect(findLessonTestAnswer({ question: 'Дубль с разным ключом', options: ['да', 'нет'] }, bank)).toBeUndefined();
    expect(findLessonTestAnswer({
      question: 'Бактериологический метод разработал и ввел',
      options: ['И. Мечников', 'Л. Пастер'],
    }, bank)).toBeUndefined();
  });
});

describe('ответы к тестам в методичках', () => {
  it('находятся для занятия по микробиологии', () => {
    const dir = path.join(__dirname, '..', 'src', 'data');
    const bank = JSON.parse(fs.readFileSync(path.join(dir, 'micro_tests.json'), 'utf8'));
    const program = JSON.parse(fs.readFileSync(path.join(dir, 'programs', 'micro-stomatology-2.json'), 'utf8'));
    const tests = program.lessons.flatMap((l: { tests?: unknown[] }) => l.tests ?? []);
    const answered = attachLessonTestAnswers(tests, bank).filter(t => t.answer !== undefined);
    expect(answered.length).toBeGreaterThan(100);
  });
});
