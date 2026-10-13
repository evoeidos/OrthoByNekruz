import { alertAdmin } from '@/lib/alertAdmin';

// Детектор «замираний» сервера. Таймер тикает раз в секунду; если тик пришёл
// с опозданием больше STALL_MS, значит, процесс всё это время был занят
// синхронной работой (или его не пускали на CPU) — в этот момент стоят
// запросы всех пользователей. Алерт с памятью и временем с запуска помогает
// отличить холодный старт после деплоя, нехватку памяти и прочее.

const TICK_MS = 1_000;
const STALL_MS = 3_000;

const globalForHealth = globalThis as unknown as { __processHealthStarted?: boolean };

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

/** Сводка о процессе для алертов: память и время с запуска. */
export function processSnapshot(): string {
  const mem = process.memoryUsage();
  return `память: heap ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} МБ, rss ${mb(mem.rss)} МБ; `
    + `с запуска ${Math.round(process.uptime() / 60)} мин`;
}

export function startProcessHealthMonitor(): void {
  if (globalForHealth.__processHealthStarted) return;
  globalForHealth.__processHealthStarted = true;

  let expected = Date.now() + TICK_MS;
  const timer = setInterval(() => {
    const now = Date.now();
    const stalledMs = now - expected;
    expected = now + TICK_MS;
    if (stalledMs > STALL_MS) {
      const detail = processSnapshot();
      console.warn('[processHealth] сервер замирал', stalledMs, detail);
      alertAdmin('process:stall', `сервер замирал на ${Math.round(stalledMs / 1000)} с`, detail);
    }
  }, TICK_MS);
  timer.unref?.();
}
