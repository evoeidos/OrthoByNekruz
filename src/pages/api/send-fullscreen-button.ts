import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = '-1003929499461';

  if (!BOT_TOKEN) {
    return res.status(400).json({ error: 'BOT_TOKEN не задан' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: 'Запускай и учись! 😉',
        reply_markup: {
          inline_keyboard: [[{
            text: '📚 Открыть приложение (с плашкой)',
            web_app: {
              url: 'https://nekruz2000n-eng-orthobynekruz-a9a4.twc1.net/'
              // fullscreen убрали – inline-кнопка не умеет fullscreen
            }
          }]]
        }
      })
    });

    const data = await response.json();
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при отправке сообщения' });
  }
}