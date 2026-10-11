import { tgCall } from '@/lib/telegramApi';

// ═══════════════════════════════════════════════════════════════════════════
// Алерты админу в Telegram о сбоях сервера: 500-е, недоступный Redis,
// сменившаяся вёрстка krasgmu.ru, исчерпанный лимит Browserless и т.п.
//
// Ограничение частоты — в памяти процесса, а не в Redis: алерт должен дойти
// как раз тогда, когда Redis лежит. Один и тот же kind — не чаще раза в
// THROTTLE_MS; пропущенные за это время повторы досчитываются в следующее
// сообщение. Отправка не блокирует ответ пользователю и никогда не бросает.
// ═══════════════════════════════════════════════════════════════════════════

const THROTTLE_MS = 15 * 60 * 1000;
const MAX_DETAIL = 600;

const lastSent = new Map<string, number>();
const suppressed = new Map<string, number>();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function describe(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try { return JSON.stringify(detail); } catch { return String(detail); }
}

/**
 * kind — короткий ключ вида «auth:500» (по нему считается частота),
 * title — человеческое описание, detail — ошибка или подробности.
 */
export function alertAdmin(kind: string, title: string, detail?: unknown): void {
  const adminId = process.env.ADMIN_TG_ID;
  if (!adminId || !process.env.BOT_TOKEN) return;

  const now = Date.now();
  const prev = lastSent.get(kind) ?? 0;
  if (now - prev < THROTTLE_MS) {
    suppressed.set(kind, (suppressed.get(kind) ?? 0) + 1);
    return;
  }
  lastSent.set(kind, now);
  const repeats = suppressed.get(kind) ?? 0;
  suppressed.delete(kind);

  const lines = [`🚨 <b>ByNekruz — ${esc(title)}</b>`, `<code>${esc(kind)}</code>`];
  if (detail !== undefined) {
    lines.push('', `<pre>${esc(describe(detail).slice(0, MAX_DETAIL))}</pre>`);
  }
  if (repeats > 0) {
    lines.push('', `Ещё ${repeats} таких же за последние ${THROTTLE_MS / 60000} мин.`);
  }

  void tgCall('sendMessage', {
    chat_id: adminId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }, { timeoutMs: 5000 })
    .then(res => {
      if (!res.ok) console.error('[alertAdmin] не отправлено', res.status, res.error);
    })
    .catch(e => console.error('[alertAdmin] ошибка отправки', e));
}
