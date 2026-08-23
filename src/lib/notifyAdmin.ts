import { getSubject } from '@/lib/subjects';
import { formatAdminModuleLabel } from '@/lib/previewModuleStatus';
import type { PreviewModule } from '@/lib/previewModules';

const BOT_TOKEN   = process.env.BOT_TOKEN   || '';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '';
const ADMIN_URL   = process.env.ADMIN_URL   || 'https://nekruz2000n-eng-orthobynekruz-a9a4.twc1.net/admin';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Уведомление админу: студент нажал «Скинул — войти». */
export async function notifyAdminReceiptClaimed(params: {
  tgId: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  subjectId: string;
  modules: PreviewModule[];
}): Promise<void> {
  if (!BOT_TOKEN || !ADMIN_TG_ID) {
    console.error('[notifyAdmin] BOT_TOKEN или ADMIN_TG_ID не заданы');
    return;
  }

  const name = [params.firstName, params.lastName].filter(Boolean).join(' ').trim() || 'без имени';
  const uname = params.username
    ? `@${String(params.username).replace(/^@/, '')}`
    : 'без username';
  const subjectLabel = getSubject(params.subjectId)?.label || params.subjectId;
  const modulesLabel = params.modules.length > 0
    ? params.modules.map(m => formatAdminModuleLabel(params.subjectId, m)).join(', ')
    : '—';

  const text = [
    '💳 <b>ByNekruz — скинул чек</b>',
    '',
    'Студент нажал «Скинул — войти».',
    'Временный доступ открыт на <b>1 час</b> — проверь, пришла ли оплата на СБП.',
    '',
    `Telegram ID: <code>${esc(String(params.tgId))}</code>`,
    `Имя: ${esc(name)}`,
    `Ник: ${esc(uname)}`,
    '',
    `Заявка: <b>${esc(subjectLabel)}</b> · ${esc(modulesLabel)}`,
    '',
    'В админке: ✓ подтвердить или ✕ отказ.',
    'Не оплатил — жми ✕, иначе через час доступ сам закроется.',
  ].join('\n');

  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    ADMIN_TG_ID,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '⚙️ Открыть админку', web_app: { url: ADMIN_URL, fullscreen: true } },
          ]],
        },
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('[notifyAdmin] Telegram error:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('[notifyAdmin] fetch error:', e);
  }
}
