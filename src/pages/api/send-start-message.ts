import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  // 1. УБЕДИСЬ, ЧТО ЭТО ТВОЙ ЛИЧНЫЙ ID (без -100)
  // Для тестов можно брать его из тела запроса, если шлешь самому себе
  const MY_USER_ID = '978243325'; 

  if (!BOT_TOKEN || !MY_USER_ID || MY_USER_ID.startsWith('-100')) {
    return res.status(400).json({ error: 'Нужен личный Telegram ID пользователя' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: MY_USER_ID,
        text: '🚀 Твой путеводитель в мир протезирования готов!',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💎 Открыть ByNekruz',
                web_app: {
                  url: 'https://nekruz2000n-eng-orthobynekruz-91ba.twc1.net/'
                }
              }
            ]
          ]
        }
      })
    });

    const data = await response.json();
    
    if (!data.ok) {
      return res.status(500).json({ error: 'TG API Error', details: data });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при отправке' });
  }
}