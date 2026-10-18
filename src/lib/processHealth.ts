import Module from 'module';
import { alertAdmin } from '@/lib/alertAdmin';

// Детектор «замираний» сервера. Таймер тикает раз в секунду; если тик пришёл
// с опозданием больше STALL_MS, значит, процесс всё это время был занят
// синхронной работой (или его не пускали на CPU) — в этот момент стоят
// запросы всех пользователей. Алерт с памятью и временем с запуска помогает
// отличить холодный старт после деплоя, нехватку памяти и прочее.
//
// Чтобы по алерту было видно причину, за каждую секунду считаем:
// - CPU, потраченный процессом. Почти равен паузе — процесс сам считал
//   (тяжёлый код). Сильно меньше паузы — процесс ждал: синхронное чтение
//   с диска или контейнер не давали CPU (урезание, заморозка при деплое).
// - загрузку модулей (require): сколько файлов и времени, самый долгий.
//   Каждый require — синхронное чтение с диска и разбор кода.

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

type RequireStats = { count: number; ms: number; slowest: { id: string; ms: number } | null };

const requireStats: RequireStats = { count: 0, ms: 0, slowest: null };

/** Учёт require верхнего уровня: вложенные загрузки входят во время внешней. */
function trackModuleLoads(): void {
  const mod = Module as unknown as { _load?: (...args: unknown[]) => unknown };
  const original = mod._load;
  if (typeof original !== 'function') return;
  let depth = 0;
  mod._load = function trackedLoad(this: unknown, ...args: unknown[]) {
    if (depth > 0) return original.apply(this, args);
    depth++;
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      depth--;
      const ms = performance.now() - started;
      requireStats.count++;
      requireStats.ms += ms;
      if (!requireStats.slowest || ms > requireStats.slowest.ms) {
        requireStats.slowest = { id: String(args[0]), ms };
      }
    }
  };
}

function takeRequireStats(): RequireStats {
  const snapshot = { ...requireStats };
  requireStats.count = 0;
  requireStats.ms = 0;
  requireStats.slowest = null;
  return snapshot;
}

function describeStall(stalledMs: number, cpuMs: number, loads: RequireStats): string {
  // Окно замера CPU — опоздавший тик целиком: пауза плюс сам интервал.
  const share = Math.round((cpuMs / (stalledMs + TICK_MS)) * 100);
  const lines = [`CPU процесса за паузу: ${Math.round(cpuMs)} мс (${share}% паузы)`];
  if (loads.count > 0) {
    const slowest = loads.slowest
      ? `, самый долгий ${loads.slowest.id.slice(-80)} — ${Math.round(loads.slowest.ms)} мс`
      : '';
    lines.push(`загрузка модулей: ${loads.count} шт., ${Math.round(loads.ms)} мс${slowest}`);
  } else {
    lines.push('загрузка модулей: не было');
  }
  if (share < 50) {
    lines.push(loads.ms > stalledMs / 2
      ? 'вывод: процесс ждал диск при загрузке модулей'
      : 'вывод: процессу не давали CPU (урезание или заморозка контейнера)');
  } else {
    lines.push(loads.ms > stalledMs / 2
      ? 'вывод: процесс разбирал загружаемые модули'
      : 'вывод: тяжёлый синхронный код в самом процессе');
  }
  return lines.join('\n');
}

export function startProcessHealthMonitor(): void {
  if (globalForHealth.__processHealthStarted) return;
  globalForHealth.__processHealthStarted = true;

  trackModuleLoads();
  let expected = Date.now() + TICK_MS;
  let lastCpu = process.cpuUsage();
  const timer = setInterval(() => {
    const now = Date.now();
    const stalledMs = now - expected;
    expected = now + TICK_MS;
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const loads = takeRequireStats();
    if (stalledMs > STALL_MS) {
      const cpuMs = (cpu.user + cpu.system) / 1000;
      const detail = `${describeStall(stalledMs, cpuMs, loads)}\n${processSnapshot()}`;
      console.warn('[processHealth] сервер замирал', stalledMs, detail);
      // Пауза почти без CPU и без загрузки модулей — платформа заморозила
      // serverless-контейнер между запросами (путь /var/task). Это не
      // исправить в коде, и алерт о ней — шум; вред для студентов, если он
      // есть, покажет алерт о долгой блокировке пользователя.
      const frozen = cpuMs < (stalledMs + TICK_MS) / 2 && loads.ms < stalledMs / 2;
      if (!frozen) {
        alertAdmin('process:stall', `сервер замирал на ${Math.round(stalledMs / 1000)} с`, detail);
      }
    }
  }, TICK_MS);
  timer.unref?.();
}
