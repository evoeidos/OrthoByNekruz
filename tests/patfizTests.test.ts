import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATFIZ_TESTS_STOM_FILE, PATFIZ_TESTS_THER_PED_FILE, resolvePatfizTestsFile } from '@/lib/patfizTests';
import { getAllDataFileNames, getSubject } from '@/lib/subjects';

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

describe('банки тестов по патофизиологии', () => {
  it('лечебному делу и педиатрии — общий курс, стоматологам и без факультета — свой', () => {
    expect(resolvePatfizTestsFile('therapeutic')).toBe(PATFIZ_TESTS_THER_PED_FILE);
    expect(resolvePatfizTestsFile('pediatrics')).toBe(PATFIZ_TESTS_THER_PED_FILE);
    expect(resolvePatfizTestsFile('stomatology')).toBe(PATFIZ_TESTS_STOM_FILE);
    expect(resolvePatfizTestsFile(null)).toBe(PATFIZ_TESTS_STOM_FILE);
    expect(getSubject('patfiz')?.testsFile).toBe(PATFIZ_TESTS_STOM_FILE);
  });

  // loadDataFile отдаёт только файлы из getAllDataFileNames: банк не из списка
  // студент получил бы как 404 «Data file not found».
  it.each(['pediatrics', 'stomatology', 'therapeutic', null])('банк для %s есть на сервере', faculty => {
    const file = resolvePatfizTestsFile(faculty);
    expect(getAllDataFileNames()).toContain(file);
    expect(fs.existsSync(path.join(DATA_DIR, file))).toBe(true);
  });
});
