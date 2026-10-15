import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOXIM_TESTS_FILE, BIOXIM_TESTS_PED_FILE, resolveBioximTestsFile } from '@/lib/bioximTests';
import { getAllDataFileNames, getSubject } from '@/lib/subjects';

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

describe('банки тестов по биохимии', () => {
  it('педиатрам — свой банк, остальным — общий', () => {
    expect(resolveBioximTestsFile('pediatrics')).toBe(BIOXIM_TESTS_PED_FILE);
    expect(resolveBioximTestsFile('stomatology')).toBe(BIOXIM_TESTS_FILE);
    expect(resolveBioximTestsFile('therapeutic')).toBe(BIOXIM_TESTS_FILE);
    expect(resolveBioximTestsFile(null)).toBe(BIOXIM_TESTS_FILE);
    expect(getSubject('bioxim')?.testsFile).toBe(BIOXIM_TESTS_FILE);
  });

  // loadDataFile отдаёт только файлы из getAllDataFileNames: банк не из списка
  // студент получил бы как 404 «Data file not found».
  it.each(['pediatrics', 'stomatology', 'therapeutic', null])('банк для %s есть на сервере', faculty => {
    const file = resolveBioximTestsFile(faculty);
    expect(getAllDataFileNames()).toContain(file);
    expect(fs.existsSync(path.join(DATA_DIR, file))).toBe(true);
  });
});
