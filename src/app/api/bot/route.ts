import { NextResponse } from 'next/server';
import { createRedisFromEnv } from '@/lib/redis';
import { getTelegramApiBase, tgCall } from '@/lib/telegramApi';

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const APP_URL = process.env.APP_URL || 'https://nekruz2000n-eng-orthobynekruz-a9a4.twc1.net';
const ADMIN_URL = process.env.ADMIN_URL || `${APP_URL}/admin`;
const CHANNEL_USERNAME = 'nzsdental';

function getRedis() {
  try {
    return createRedisFromEnv();
  } catch (e) {
    console.error('[bot] redis unavailable', e);
    return null;
  }
}

async function tgSend(chatId: number, body: Record<string, unknown>) {
  const res = await tgCall('sendMessage', { chat_id: chatId, ...body }, { timeoutMs: 8000 });
  if (!res.ok) {
    console.error('[bot] sendMessage failed', res.status, res.error);
  }
}

async function isSubscribed(userId: number): Promise<boolean> {
  const res = await tgCall<{ status: string }>(
    'getChatMember',
    { chat_id: `@${CHANNEL_USERNAME}`, user_id: userId },
    { timeoutMs: 4000 },
  );
  if (!res.ok || !res.data) {
    // бот не админ канала / API ошибка / сеть — не блокируем вход молча
    console.warn('[bot] getChatMember not ok', res.error);
    return true;
  }
  return ['member', 'administrator', 'creator'].includes(res.data.status);
}

function commandOf(text: string): string {
  // "/start", "/Start@BotName payload" → "start"
  const raw = text.trim().split(/\s+/)[0] || '';
  return raw.toLowerCase().replace(/^\//, '').split('@')[0];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('diag') !== '1') {
    return NextResponse.json({ ok: true });
  }
  const started = Date.now();
  const out: Record<string, unknown> = {
    hasToken: !!BOT_TOKEN,
    appUrl: APP_URL,
    adminTgId: ADMIN_TG_ID ? 'set' : 'missing',
    telegramApiBase: getTelegramApiBase(),
  };
  const res = await tgCall<{ username?: string }>('getMe', undefined, { timeoutMs: 8000 });
  out.telegramReachable = res.ok;
  out.telegramStatus = res.status;
  out.botUsername = res.data?.username ?? null;
  if (!res.ok) out.telegramError = res.error;
  out.elapsedMs = Date.now() - started;
  return NextResponse.json(out);
}

/**
 * Апдейт уже обработан? Telegram ретраит доставку при таймауте/сетевом сбое,
 * без дедупликации мы повторно выполним команду и пошлём сообщение дважды.
 * Ключ живёт час — этого с запасом хватает на все ретраи Telegram.
 */
async function isDuplicateUpdate(updateId: unknown): Promise<boolean> {
  if (typeof updateId !== 'number') return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    // set(..., { nx: true }) вернёт null, если ключ уже существует.
    // Таймаут обязателен: раньше /start Redis не трогал, а зависание
    // подключения убивает весь вебхук — Telegram не дождётся ответа.
    const stored = await Promise.race([
      redis.set(`tg_update:${updateId}`, 1, { ex: 3600, nx: true }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('dedup timeout')), 800);
      }),
    ]);
    return stored === null;
  } catch (e) {
    console.error('[bot] dedup check failed', e);
    return false;
  }
}

export async function POST(req: Request) {
  try {
    // Секрет отклоняет запрос только если заголовок ПРИШЁЛ и он неверный.
    // Если секрета нет в env или прокси/старый вебхук не шлёт заголовок —
    // пропускаем: иначе /start молчит, пока вебхук не перерегистрируют.
    if (WEBHOOK_SECRET) {
      const provided = req.headers.get('x-telegram-bot-api-secret-token');
      if (provided && provided !== WEBHOOK_SECRET) {
        console.warn('[bot] отклонён запрос с неверным secret token');
        return NextResponse.json({ ok: false }, { status: 401 });
      }
      if (!provided) {
        console.warn('[bot] webhook secret задан, но заголовок отсутствует — пропускаем');
      }
    }

    const update = await req.json();

    if (await isDuplicateUpdate(update?.update_id)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const chatMember = update?.chat_member ?? update?.my_chat_member;
    if (chatMember) {
      const chat = chatMember.chat;
      const newStatus = chatMember.new_chat_member?.status;
      const userId = chatMember.new_chat_member?.user?.id;
      const isOurChannel = chat?.username === CHANNEL_USERNAME;
      const isLeaving = ['left', 'kicked', 'banned'].includes(newStatus);

      if (isOurChannel && isLeaving && userId) {
        const redis = getRedis();
        if (redis) {
          await redis.set(`unsub:${userId}`, 1, { ex: 60 * 60 * 24 * 7 });
        }
      }
    }

    const message = update?.message;

    if (message && message.text) {
      const cmd = commandOf(message.text);
      const chatId = message.chat.id;
      const userId = message.from?.id;

      if (!userId) {
        return NextResponse.json({ ok: true });
      }

      if (cmd === 'admin') {
        if (String(userId) === String(ADMIN_TG_ID)) {
          await tgSend(chatId, {
            text: 'Система безопасности пройдена. Добро пожаловать, Создатель.',
            reply_markup: {
              inline_keyboard: [[{ text: '⚙️ Открыть Админку', web_app: { url: ADMIN_URL } }]],
            },
          });
        } else {
          console.log(`Попытка доступа к админке от чужого ID: ${userId}`);
        }
        return NextResponse.json({ ok: true });
      }

      if (cmd === 'start') {
        const subscribed = await isSubscribed(userId);
        if (subscribed) {
          await tgSend(chatId, {
            text: 'Привет! 🦷\nТвой помощник готов к работе:',
            reply_markup: {
              inline_keyboard: [[{ text: '🚀 Открыть ByNekruz', web_app: { url: `${APP_URL}/` } }]],
            },
          });
        } else {
          await tgSend(chatId, {
            text: `Чтобы воспользоваться ботом, подпишись на канал @${CHANNEL_USERNAME} и нажми /start ещё раз.`,
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[bot] handler error', e);
    return NextResponse.json({ ok: true });
  }
}
