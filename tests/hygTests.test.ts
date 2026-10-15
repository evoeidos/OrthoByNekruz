import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HYG_TESTS_PED_FILE, HYG_TESTS_STOM_FILE, HYG_TESTS_THERAPEUTIC_FILE, resolveHygTestsFile,
} from '@/lib/hygTests';
import { getAllDataFileNames, getSubject } from '@/lib/subjects';

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

describe('банки тестов по гигиене', () => {
  it('у каждого факультета своё издание, без факультета — стоматология', () => {
    expect(resolveHygTestsFile('stomatology')).toBe(HYG_TESTS_STOM_FILE);
    expect(resolveHygTestsFile('pediatrics')).toBe(HYG_TESTS_PED_FILE);
    expect(resolveHygTestsFile('therapeutic')).toBe(HYG_TESTS_THERAPEUTIC_FILE);
    expect(resolveHygTestsFile(null)).toBe(HYG_TESTS_STOM_FILE);
    expect(getSubject('hyg')?.testsFile).toBe(HYG_TESTS_STOM_FILE);
  });

  // loadDataFile отдаёт только файлы из getAllDataFileNames: банк не из списка
  // студент получил бы как 404 «Data file not found».
  it.each(['pediatrics', 'stomatology', 'therapeutic', null])('банк для %s есть на сервере', faculty => {
    const file = resolveHygTestsFile(faculty);
    expect(getAllDataFileNames()).toContain(file);
    expect(fs.existsSync(path.join(DATA_DIR, file))).toBe(true);
  });
});
