import http from 'http';
import Module from 'module';
import { PerformanceObserver } from 'perf_hooks';
import v8 from 'v8';
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
// - сборку мусора: при heap у лимита V8 может секундами чистить память,
//   и это тоже выглядит как «процесс занят».
// - HTTP-запросы, шедшие во время паузы: какой из них держал процесс.

const TICK_MS = 1_000;
const STALL_MS = 3_000;

const globalForHealth = globalThis as unknown as { __processHealthStarted?: boolean };

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

/** Сводка о процессе для алертов: память, лимит heap и время с запуска. */
export function processSnapshot(): string {
  const mem = process.memoryUsage();
  const limit = mb(v8.getHeapStatistics().heap_size_limit);
  return `память: heap ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} МБ (лимит ${limit}), rss ${mb(mem.rss)} МБ; `
    + `с запуска ${Math.round(process.uptime() / 60)} мин`;
}

// ─── Загрузка модулей ──────────────────────────────────────────────────────

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

// ─── Сборка мусора ─────────────────────────────────────────────────────────

let gcMs = 0;
let gcSlowestMs = 0;

function trackGc(): void {
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        gcMs += entry.duration;
        if (entry.duration > gcSlowestMs) gcSlowestMs = entry.duration;
      }
    }).observe({ entryTypes: ['gc'] });
  } catch { /* без учёта GC алерт всё равно придёт */ }
}

function takeGcStats(): { ms: number; slowestMs: number } {
  const snapshot = { ms: gcMs, slowestMs: gcSlowestMs };
  gcMs = 0;
  gcSlowestMs = 0;
  return snapshot;
}

// ─── HTTP-запросы ──────────────────────────────────────────────────────────
//
// Тело POST не читаем (его разбирает Next), поэтому видно только URL; для
// /api/auth участок покажет алерт о долгой блокировке пользователя.

type RequestInfo = { url: string; startedAt: number; endedAt?: number };

const activeRequests = new Set<RequestInfo>();
const finishedRequests: RequestInfo[] = [];
const FINISHED_KEEP_MS = 30_000;
const FINISHED_MAX = 200;

function trackHttpRequests(): void {
  const proto = http.Server.prototype as unknown as {
    emit: (this: unknown, event: string, ...args: unknown[]) => boolean;
  };
  const originalEmit = proto.emit;
  proto.emit = function trackedEmit(this: unknown, event: string, ...args: unknown[]) {
    if (event === 'request') {
      const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
      const info: RequestInfo = {
        url: `${req.method ?? ''} ${String(req.url ?? '').split('?')[0]}`.slice(0, 60),
        startedAt: Date.now(),
      };
      activeRequests.add(info);
      res.once('close', () => {
        activeRequests.delete(info);
        info.endedAt = Date.now();
        finishedRequests.push(info);
        if (finishedRequests.length > FINISHED_MAX) {
          finishedRequests.splice(0, finishedRequests.length - FINISHED_MAX);
        }
      });
    }
    return originalEmit.call(this, event, ...args);
  };
}

/** Запросы, которые шли в окне паузы: ещё идут или закончились внутри неё. */
function requestsDuring(fromMs: number, now: number): string {
  while (finishedRequests.length && (finishedRequests[0].endedAt ?? 0) < now - FINISHED_KEEP_MS) {
    finishedRequests.shift();
  }
  const overlapping = [
    ...[...activeRequests].map(r => ({ url: r.url, ms: now - r.startedAt, active: true })),
    ...finishedRequests
      .filter(r => (r.endedAt ?? 0) >= fromMs)
      .map(r => ({ url: r.url, ms: (r.endedAt ?? now) - r.startedAt, active: false })),
  ].sort((a, b) => b.ms - a.ms);
  if (!overlapping.length) return 'запросы во время паузы: не было';
  const top = overlapping.slice(0, 5)
    .map(r => `${r.url} — ${(r.ms / 1000).toFixed(1)} с${r.active ? ' (идёт)' : ''}`)
    .join('\n');
  return `запросы во время паузы (${overlapping.length}):\n${top}`;
}

// ─── Алерт ─────────────────────────────────────────────────────────────────

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
  trackGc();
  trackHttpRequests();
  let expected = Date.now() + TICK_MS;
  let lastCpu = process.cpuUsage();
  const timer = setInterval(() => {
    const now = Date.now();
    const stalledMs = now - expected;
    expected = now + TICK_MS;
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const loads = takeRequireStats();
    const gc = takeGcStats();
    if (stalledMs > STALL_MS) {
      const cpuMs = (cpu.user + cpu.system) / 1000;
      const detail = [
        describeStall(stalledMs, cpuMs, loads),
        `сборка мусора: ${Math.round(gc.ms)} мс, самая долгая ${Math.round(gc.slowestMs)} мс`,
        requestsDuring(now - stalledMs - TICK_MS, now),
        processSnapshot(),
      ].join('\n');
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
