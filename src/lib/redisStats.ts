import { AsyncLocalStorage } from 'async_hooks';

/**
 * Учёт обращений к Redis внутри одного участка кода (сейчас — пока держится
 * блокировка пользователя). Нужен, чтобы алерт о долгой блокировке сразу
 * говорил, в чём дело: много обращений, одна медленная команда или процесс
 * был занят чем-то другим.
 */
export type RedisCallStats = {
  calls: number;
  totalMs: number;
  slowest: { cmd: string; key: string; ms: number } | null;
};

const statsStore = new AsyncLocalStorage<RedisCallStats>();

export function newRedisCallStats(): RedisCallStats {
  return { calls: 0, totalMs: 0, slowest: null };
}

export function runWithRedisStats<T>(stats: RedisCallStats, fn: () => T): T {
  return statsStore.run(stats, fn);
}

export function recordRedisCall(cmd: string, key: string, ms: number): void {
  const stats = statsStore.getStore();
  if (!stats) return;
  stats.calls++;
  stats.totalMs += ms;
  if (!stats.slowest || ms > stats.slowest.ms) stats.slowest = { cmd, key, ms };
}

/** Telegram ID и другие длинные числа в ключах — в алерт без них. */
export function maskKey(key: string): string {
  return key.replace(/\d{5,}/g, '<id>');
}
