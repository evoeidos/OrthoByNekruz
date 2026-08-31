/** Один раз на устройство: после прохождения или «Пропустить» тур больше не открывается. */
export const COACH_TOUR_SEEN_KEY = 'has_seen_onboarding_v1';

/**
 * Клик по затемнению закрывает тур.
 * По умолчанию выкл. — в Telegram WebView легко попасть по фону пальцем,
 * поэтому выход только через «Далее» / «Пропустить» / «Понятно».
 */
export const COACH_TOUR_DISMISS_ON_BACKDROP = false;

export type CoachPlacement = 'above' | 'below';

export type CoachBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type CoachInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type CoachStep = {
  id: string;
  /** Значение атрибута data-coach на целевом элементе. */
  target: string;
  title: string;
  body: string;
  /** Переключить нижний таб, чтобы подсветка совпала с активной пилюлей. */
  tab?: 'lessons' | 'questions' | 'tests' | 'tasks' | 'stats';
};

export const COACH_TOUR_STEPS: CoachStep[] = [
  {
    id: 'nav-bar',
    target: 'nav-bar',
    title: 'Главное меню',
    body: 'Внизу четыре кнопки — это всё приложение. Жми туда, куда надо, остальное не ищи.',
  },
  {
    id: 'nav-lessons',
    target: 'nav-lessons',
    tab: 'lessons',
    title: 'Занятия',
    body: 'Конспекты и разборы по темам. Если ещё не открывал занятие — начинай отсюда.',
  },
  {
    id: 'nav-exam',
    target: 'nav-exam',
    tab: 'questions',
    title: 'Экзамен',
    body: 'Вопросы и задачи, как будут спрашивать. Гоняй, когда уже что-то читал, а не в первый день.',
  },
  {
    id: 'nav-tests',
    target: 'nav-tests',
    tab: 'tests',
    title: 'Тест',
    body: 'Короткая проверка по темам. Удобно перед парой или чтобы понять, что ещё не село.',
  },
  {
    id: 'nav-stats',
    target: 'nav-stats',
    tab: 'stats',
    title: 'Профиль',
    body: 'Прогресс, смена предмета и настройки. Сюда же — если что-то открылось не так.',
  },
];

export function coachSelector(target: string): string {
  return `[data-coach="${target}"]`;
}

export function hasSeenCoachTour(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(COACH_TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markCoachTourSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COACH_TOUR_SEEN_KEY, '1');
  } catch {
    /* quota / private mode */
  }
}

export const COACH_TOUR_RESTART_EVENT = 'coach-tour-restart';

/** Сбросить флаг и заново открыть тур (из профиля). */
export function restartCoachTour(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(COACH_TOUR_SEEN_KEY);
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(COACH_TOUR_RESTART_EVENT));
}

export function stepAvailable(
  step: CoachStep,
  hiddenTabs: Array<'lessons' | 'questions' | 'tests' | 'tasks' | 'stats'>,
): boolean {
  if (!step.tab) return true;
  if (step.id === 'nav-exam') {
    return !hiddenTabs.includes('questions') || !hiddenTabs.includes('tasks');
  }
  return !hiddenTabs.includes(step.tab);
}

export function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}

export function getVisualViewportBox(): CoachBox {
  if (typeof window === 'undefined') {
    return { top: 0, left: 0, width: 390, height: 844 };
  }
  const vv = window.visualViewport;
  // overlay position:fixed — координаты layout viewport (обычно offset = 0 в Mini App).
  return {
    top: 0,
    left: 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

export function readSafePadding(): CoachInsets {
  if (typeof document === 'undefined') {
    return { top: 12, right: 12, bottom: 12, left: 12 };
  }
  const root = getComputedStyle(document.documentElement);
  const headerPt = parseFloat(root.getPropertyValue('--header-pt')) || 12;
  const navBottom = parseFloat(root.getPropertyValue('--nav-bottom')) || 0;
  // Шапка Telegram уже вычтена из visualViewport в Fullsize; оставляем небольшой зазор.
  const top = Math.max(12, Math.min(headerPt, 28));
  const bottom = Math.max(12, navBottom + 8);
  return { top, right: 12, bottom, left: 12 };
}

export function isBoxFullyVisible(
  box: CoachBox,
  viewport: CoachBox,
  margin = 8,
): boolean {
  return (
    box.top >= viewport.top + margin
    && box.left >= viewport.left + margin
    && box.top + box.height <= viewport.top + viewport.height - margin
    && box.left + box.width <= viewport.left + viewport.width - margin
  );
}

export function isElementInVisualViewport(el: Element, margin = 8): boolean {
  if (typeof window === 'undefined') return true;
  const r = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const left = vv?.offsetLeft ?? 0;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;
  return (
    r.top >= top + margin
    && r.left >= left + margin
    && r.bottom <= top + height - margin
    && r.right <= left + width - margin
  );
}

function boxesOverlap(a: CoachBox, b: CoachBox, gap = 8): boolean {
  return (
    a.left < b.left + b.width + gap
    && a.left + a.width + gap > b.left
    && a.top < b.top + b.height + gap
    && a.top + a.height + gap > b.top
  );
}

export function holeFromElement(el: HTMLElement, pad = 6): CoachBox & { radius: number } {
  const r = el.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(el).borderRadius) || 16;
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
    radius: Number.isFinite(radius) ? radius : 16,
  };
}

/**
 * Ставит тултип сверху или снизу от цели и зажимает в видимую область
 * Telegram WebApp (visualViewport + safe padding), чтобы карточка не уезжала
 * за край экрана и не перекрывала подсветку.
 */
export function placeTooltip(opts: {
  target: CoachBox;
  tooltip: { width: number; height: number };
  viewport: CoachBox;
  padding: CoachInsets;
  gap?: number;
}): { left: number; top: number; placement: CoachPlacement; arrowOffset: number } {
  const gap = opts.gap ?? 12;
  const { target, viewport, padding } = opts;
  const availW = Math.max(0, viewport.width - padding.left - padding.right);
  const availH = Math.max(0, viewport.height - padding.top - padding.bottom);
  const tw = Math.min(opts.tooltip.width, availW);
  const th = Math.min(opts.tooltip.height, availH);

  const minLeft = viewport.left + padding.left;
  const maxLeft = minLeft + availW - tw;
  const minTop = viewport.top + padding.top;
  const maxTop = minTop + availH - th;

  const spaceAbove = target.top - minTop;
  const spaceBelow = (viewport.top + viewport.height - padding.bottom) - (target.top + target.height);
  const need = th + gap;

  let placement: CoachPlacement;
  if (spaceAbove >= need && spaceBelow >= need) {
    // Нижняя навигация Mini App — почти всегда выгоднее карточка сверху.
    placement = target.top > viewport.top + viewport.height * 0.42 ? 'above' : 'below';
  } else if (spaceAbove >= need) {
    placement = 'above';
  } else if (spaceBelow >= need) {
    placement = 'below';
  } else {
    placement = spaceAbove >= spaceBelow ? 'above' : 'below';
  }

  let top = placement === 'above'
    ? target.top - gap - th
    : target.top + target.height + gap;
  top = clamp(top, minTop, maxTop);

  let left = target.left + target.width / 2 - tw / 2;
  left = clamp(left, minLeft, maxLeft);

  const card: CoachBox = { left, top, width: tw, height: th };
  if (boxesOverlap(card, target, gap)) {
    const flipped: CoachPlacement = placement === 'above' ? 'below' : 'above';
    let flippedTop = flipped === 'above'
      ? target.top - gap - th
      : target.top + target.height + gap;
    flippedTop = clamp(flippedTop, minTop, maxTop);
    const flippedCard: CoachBox = { left, top: flippedTop, width: tw, height: th };
    if (!boxesOverlap(flippedCard, target, gap)) {
      placement = flipped;
      top = flippedTop;
    }
  }

  const targetCenter = target.left + target.width / 2;
  const arrowOffset = clamp(targetCenter - left, 18, Math.max(18, tw - 18));

  return { left, top, placement, arrowOffset };
}
