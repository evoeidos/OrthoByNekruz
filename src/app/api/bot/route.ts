import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const ADMIN_URL = process.env.ADMIN_URL || 'https://nekruz2000n-eng-orthobynekruz-91ba.twc1.net/admin';
const CHANNEL_USERNAME = 'nzsdental';

async function isSubscribed(userId: number): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${CHANNEL_USERNAME}&user_id=${userId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return false;
    const status = data.result.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const update = await req.json();

  // Событие отписки от канала
  const chatMember = update?.chat_member ?? update?.my_chat_member;
  if (chatMember) {
    const chat     = chatMember.chat;
    const newStatus = chatMember.new_chat_member?.status;
    const userId   = chatMember.new_chat_member?.user?.id;
    const isOurChannel = chat?.username === CHANNEL_USERNAME;
    const isLeaving = ['left', 'kicked', 'banned'].includes(newStatus);

    if (isOurChannel && isLeaving && userId) {
      // Помечаем флагом — при следующем открытии приложения auth.ts заблокирует доступ
      // (проверка подписки уже есть в auth.ts, этот флаг — для моментального логаута)
      await redis.set(`unsub:${userId}`, 1, { ex: 60 * 60 * 24 * 7 }); // TTL 7 дней
    }
  }

  const message = update?.message;

  if (message && message.text) {
    const text = message.text.trim().toLowerCase();
    const chatId = message.chat.id;
    const userId = message.from?.id;

    if (!userId) {
      return NextResponse.json({ ok: true });
    }

    if (text === '/admin') {
      if (String(userId) === String(ADMIN_TG_ID)) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: 'Система безопасности пройдена. Добро пожаловать, Создатель.',
            reply_markup: {
              inline_keyboard: [[{ text: '⚙️ Открыть Админку', web_app: { url: ADMIN_URL, fullscreen: true } }]]
            }
          })
        });
      } else {
        console.log(`Попытка доступа к админке от чужого ID: ${userId}`);
      }
      return NextResponse.json({ ok: true });
    }

    if (text === '/start') {
      const subscribed = await isSubscribed(userId);
      if (subscribed) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: 'Привет! 🦷\nТвой помощник готов к работе:',
            reply_markup: {
              inline_keyboard: [[{ text: '🚀 Открыть ByNekruz', web_app: { url: 'https://nekruz2000n-eng-orthobynekruz-91ba.twc1.net/', fullscreen: true } }]],
            },
          }),
        });
      } else {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `Чтобы воспользоваться ботом, подпишись на канал @${CHANNEL_USERNAME} и нажми /start ещё раз.`,
          }),
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
