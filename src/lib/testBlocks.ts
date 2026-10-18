/**
 * Размер блока во вкладке тестов: студент сам выбирает, по сколько тестов
 * решать. Лучшие результаты и попытки хранятся по номеру блока, поэтому для
 * каждого размера — свой ключ в localStorage. У размера 25 (как было до
 * настройки) ключ без суффикса, чтобы старый прогресс не пропал.
 */

export const DEFAULT_TESTS_PER_BLOCK = 25;
export const MIN_TESTS_PER_BLOCK = 5;
export const MAX_TESTS_PER_BLOCK = 200;
export const TESTS_PER_BLOCK_PRESETS = [10, 15, 20, 25, 30, 50, 100] as const;

/** localStorage: выбранный размер блока (общий для всех предметов). */
export const LS_TESTS_PER_BLOCK = 'tests_per_block';

export function clampTestsPerBlock(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_TESTS_PER_BLOCK;
  return Math.min(MAX_TESTS_PER_BLOCK, Math.max(MIN_TESTS_PER_BLOCK, Math.round(n)));
}

export function blockStorageKey(baseKey: string, perBlock: number): string {
  return perBlock === DEFAULT_TESTS_PER_BLOCK ? baseKey : `${baseKey}_by${perBlock}`;
}

type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem'>;

/** Все ключи результатов предмета — по одному на каждый размер блока. */
export function blockScoreKeys(storage: StorageLike, baseKey: string): string[] {
  const keys: string[] = [];
  const prefix = `${baseKey}_by`;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (key === baseKey || (key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)))) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Сколько тестов решено верно для статистики: сумма лучших результатов по
 * блокам. Разные размеры блоков покрывают одни и те же тесты, поэтому берём
 * размер с наибольшей суммой, а не складываем их.
 */
export function bestTestScoreTotal(storage: StorageLike, baseKey: string): number {
  let best = 0;
  for (const key of blockScoreKeys(storage, baseKey)) {
    try {
      const scores = JSON.parse(storage.getItem(key) || '{}') as Record<string, unknown>;
      const sum = Object.values(scores).reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0);
      if (sum > best) best = sum;
    } catch {}
  }
  return best;
}
