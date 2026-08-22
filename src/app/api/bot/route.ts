import { NextResponse } from 'next/server';
import { createRedisFromEnv } from '@/lib/redis';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const APP_URL = process.env.APP_URL || 'https://nekruz2000n-eng-orthobynekruz-91ba.twc1.net';
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
  if (!BOT_TOKEN) {
    console.error('[bot] BOT_TOKEN missing');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, ...body }),
    });
    if (!res.ok) {
      console.error('[bot] sendMessage failed', res.status, await res.text());
    }
  } catch (e) {
    console.error('[bot] sendMessage error', e);
  }
}

async function isSubscribed(userId: number): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${CHANNEL_USERNAME}&user_id=${userId}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json();
    if (!data.ok) {
      // бот не админ канала / API ошибка — не блокируем вход молча
      console.warn('[bot] getChatMember not ok', data);
      return true;
    }
    const status = data.result.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch (e) {
    console.warn('[bot] isSubscribed failed, allowing start', e);
    return true;
  }
}

function commandOf(text: string): string {
  // "/start", "/Start@BotName payload" → "start"
  const raw = text.trim().split(/\s+/)[0] || '';
  return raw.toLowerCase().replace(/^\//, '').split('@')[0];
}

export async function POST(req: Request) {
  try {
    const update = await req.json();

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
