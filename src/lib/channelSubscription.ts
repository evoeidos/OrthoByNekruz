const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'nzsdental';
const BOT_TOKEN = () => process.env.BOT_TOKEN || '';

export function getChannelUsername(): string {
  return CHANNEL_USERNAME;
}

export async function isChannelSubscribed(userId: number): Promise<boolean> {
  const token = BOT_TOKEN();
  if (!token) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const url =
      `https://api.telegram.org/bot${token}/getChatMember`
      + `?chat_id=@${CHANNEL_USERNAME}&user_id=${userId}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json();
    if (!data.ok) {
      console.warn('[isChannelSubscribed] not ok', data);
      return false;
    }
    const status = data.result?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch (e) {
    console.error('[isChannelSubscribed]', e);
    return false;
  }
}
