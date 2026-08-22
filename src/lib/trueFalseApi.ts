import type { TopicSessionResult } from '@/lib/trueFalse';

function tgAuthBody(extra: Record<string, unknown>) {
  const tgId     = localStorage.getItem('user_tg_id');
  const initData = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData || '';
  return { telegramId: tgId, initData, ...extra };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function saveTrueFalseSession(
  subject: string,
  percent: number,
  topicResults: TopicSessionResult[],
): Promise<void> {
  const tgId = localStorage.getItem('user_tg_id');
  if (!tgId) return;
  try {
    await fetch('/api/true-false', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgAuthBody({
        subject,
        mode: 'save_session',
        date: todayKey(),
        percent,
        topicResults,
      })),
    });
  } catch { /* офлайн */ }
}

export async function fetchWeakTrueFalseTopics(subject: string): Promise<Set<string>> {
  const tgId = localStorage.getItem('user_tg_id');
  if (!tgId) return new Set();
  try {
    const res = await fetch('/api/true-false', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgAuthBody({ subject, mode: 'list_weak' })),
    });
    const data = await res.json();
    if (!res.ok) return new Set();
    const list = Array.isArray(data.weakTopics) ? data.weakTopics.map(String) : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}
