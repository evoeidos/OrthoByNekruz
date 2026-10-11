/**
 * Сравнение выбранного варианта теста с ключом ответа. Общая логика для
 * вкладки тестов и проверки контента (tests/contentData.test.ts): если ключ
 * не совпадает ни с одним вариантом, студент не может ответить верно.
 */

/** Сравнение ответа с ключом: «2) Э. Геккель» = «Э. Геккель», «5)» = «5) К. Бэр». */
export function normalizeTestOptionText(s: string): string {
  return s
    .replace(/^[0-9]+\)\s*/u, '')
    .replace(/^[a-zа-я][\).]\s*/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function optionNumberPrefix(option: string): string | null {
  const m = option.trim().match(/^(\d+)\)/u);
  return m ? m[1] : null;
}

export function isCorrectTestOption(option: string, correct: string): boolean {
  if (option === correct) return true;
  const normOpt = normalizeTestOptionText(option);
  const normCor = normalizeTestOptionText(correct);
  if (normOpt && normCor && normOpt === normCor) return true;
  const prefixOnly = correct.trim().match(/^(\d+)\)\s*$/u);
  if (prefixOnly) {
    return optionNumberPrefix(option) === prefixOnly[1];
  }
  return false;
}

export function resolveCorrectOption(test: { options: string[]; correct: string }): string {
  return test.options.find(o => isCorrectTestOption(o, test.correct)) ?? test.correct;
}
