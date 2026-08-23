import { tgCall } from '@/lib/telegramApi';

const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'nzsdental';

export function getChannelUsername(): string {
  return CHANNEL_USERNAME;
}

export async function isChannelSubscribed(userId: number): Promise<boolean> {
  const res = await tgCall<{ status: string }>(
    'getChatMember',
    { chat_id: `@${CHANNEL_USERNAME}`, user_id: userId },
    { timeoutMs: 5000 },
  );
  if (!res.ok || !res.data) {
    console.warn('[isChannelSubscribed] not ok', res.error);
    return false;
  }
  return ['member', 'administrator', 'creator'].includes(res.data.status);
}
