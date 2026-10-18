import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TESTS_PER_BLOCK,
  MAX_TESTS_PER_BLOCK,
  MIN_TESTS_PER_BLOCK,
  bestTestScoreTotal,
  blockScoreKeys,
  blockStorageKey,
  clampTestsPerBlock,
} from '@/lib/testBlocks';

function memoryStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return {
    get length() { return keys.length; },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  };
}

describe('размер блока тестов', () => {
  it('у 25 прежний ключ, у остальных — с суффиксом размера', () => {
    expect(blockStorageKey('micro_test_block_scores', DEFAULT_TESTS_PER_BLOCK)).toBe('micro_test_block_scores');
    expect(blockStorageKey('micro_test_block_scores', 10)).toBe('micro_test_block_scores_by10');
  });

  it('размер ограничен и не ломается на мусоре', () => {
    expect(clampTestsPerBlock('40')).toBe(40);
    expect(clampTestsPerBlock(1)).toBe(MIN_TESTS_PER_BLOCK);
    expect(clampTestsPerBlock(10_000)).toBe(MAX_TESTS_PER_BLOCK);
    expect(clampTestsPerBlock('abc')).toBe(DEFAULT_TESTS_PER_BLOCK);
    expect(clampTestsPerBlock(null)).toBe(DEFAULT_TESTS_PER_BLOCK);
  });

  it('статистика берёт размер с лучшей суммой и не путает предметы', () => {
    const storage = memoryStorage({
      test_block_scores: JSON.stringify({ 1: 20, 2: 25 }),
      test_block_scores_by10: JSON.stringify({ 1: 10, 2: 10, 3: 9, 4: 10, 5: 10 }),
      test_block_scores_byX: JSON.stringify({ 1: 999 }),
      micro_test_block_scores_by10: JSON.stringify({ 1: 999 }),
    });
    expect(blockScoreKeys(storage, 'test_block_scores').sort()).toEqual(['test_block_scores', 'test_block_scores_by10']);
    expect(bestTestScoreTotal(storage, 'test_block_scores')).toBe(49);
    expect(bestTestScoreTotal(storage, 'histo_test_block_scores')).toBe(0);
  });
});
