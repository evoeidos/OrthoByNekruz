import { flashcardMember } from '@/lib/flashcards';

function tgAuthBody(extra: Record<string, unknown>) {
  const tgId    = localStorage.getItem('user_tg_id');
  const initData = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData || '';
  return { telegramId: tgId, initData, ...extra };
}

export async function fetchWeakFlashcards(subject: string): Promise<Set<string>> {
  const tgId = localStorage.getItem('user_tg_id');
  if (!tgId) return new Set();
  try {
    const res = await fetch('/api/flashcards', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgAuthBody({ subject, mode: 'list' })),
    });
    const data = await res.json();
    if (!res.ok) return new Set();
    const list = Array.isArray(data.weak) ? data.weak.map(String) : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

export async function markFlashcardWeak(
  subject: string,
  questionId: number,
  factIndex: number,
): Promise<void> {
  try {
    await fetch('/api/flashcards', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgAuthBody({
        subject,
        mode: 'mark_weak',
        questionId,
        factIndex,
      })),
    });
  } catch { /* офлайн — прогресс подтянется позже */ }
}

export async function markFlashcardKnown(
  subject: string,
  questionId: number,
  factIndex: number,
): Promise<void> {
  try {
    await fetch('/api/flashcards', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgAuthBody({
        subject,
        mode: 'mark_known',
        questionId,
        factIndex,
      })),
    });
  } catch { /* ignore */ }
}

export function cardKey(questionId: number, factIndex: number): string {
  return flashcardMember(questionId, factIndex);
}
