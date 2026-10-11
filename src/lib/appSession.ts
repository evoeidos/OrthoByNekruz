import { PREVIEW_AWAITING_CONFIRM_KEY } from '@/components/AccessWelcomeOverlay';
import { USER_FACULTY_ID_KEY } from '@/lib/facultyCodes';
import { clearUniCache } from '@/lib/uniCache';

export const AUTH_STORAGE_KEYS = [
  'is_authed',
  'user_tg_id',
  'auth_via',
  'available_subjects',
  'subject_chosen',
  'has_micro',
  'preview_end',
  'preview_start',
  'last_subject',
  'welcome_seen',
  PREVIEW_AWAITING_CONFIRM_KEY,
  USER_FACULTY_ID_KEY,
] as const;

export function readClientAuthFlag(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('is_authed') === 'true';
}

export function clearLocalSession(): void {
  if (typeof window === 'undefined') return;
  AUTH_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
  clearUniCache();
  clearSubjectPickedSession();
}

/** Сбрасывается при каждой загрузке мини-приложения — экран выбора предмета. */
export const SESSION_SUBJECT_PICKED_KEY = 'subject_picked_session';

export function hasSubjectPickedThisSession(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(SESSION_SUBJECT_PICKED_KEY) === '1';
}

export function markSubjectPickedThisSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_SUBJECT_PICKED_KEY, '1');
}

export function clearSubjectPickedSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_SUBJECT_PICKED_KEY);
}

/** Сессия валидна: TG Mini App id совпадает, либо веб-вход (auth_via=web). */
export function validateClientSession(): boolean {
  if (typeof window === 'undefined') return false;
  if (!readClientAuthFlag()) return false;

  const storedId = localStorage.getItem('user_tg_id');
  const viaWeb = localStorage.getItem('auth_via') === 'web';
  const currentId = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (currentId && storedId && String(currentId) !== storedId) {
    clearLocalSession();
    return false;
  }
  if (viaWeb && !storedId) {
    // веб без привязки TG — ещё не полный вход в приложение
    return false;
  }
  return !!storedId;
}
