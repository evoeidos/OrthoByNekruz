const token = process.env.BOT_TOKEN;
const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
if (!token || !appUrl) {
  console.error('BOT_TOKEN or APP_URL not set');
  process.exit(1);
}

// Секрет вебхука: Telegram будет слать его в заголовке
// X-Telegram-Bot-Api-Secret-Token, а /api/bot обязан его проверить.
// Без него эндпоинт открыт — кто угодно может слать поддельные апдейты.
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
if (!secret) {
  console.warn(
    'ВНИМАНИЕ: TELEGRAM_WEBHOOK_SECRET не задан — вебхук будет принимать\n'
    + 'запросы от кого угодно. Задай переменную и запусти скрипт снова.',
  );
}

const hook = `${appUrl}/api/bot`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: hook,
    allowed_updates: ['message', 'my_chat_member', 'chat_member'],
    drop_pending_updates: true,
    ...(secret ? { secret_token: secret } : {}),
  }),
});
const data = await res.json();
console.log('setWebhook ->', hook);
console.log('secret_token:', secret ? 'задан' : 'НЕ задан');
console.log('ok:', data.ok, '| description:', data.description ?? '(none)');
