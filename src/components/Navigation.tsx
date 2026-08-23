"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, ClipboardList, BarChart3, Layers, Scale, CalendarDays, GraduationCap,
} from 'lucide-react';
import { subjectHasQuestionGameModes } from '@/lib/subjects';

export type TabType = 'lessons' | 'questions' | 'tests' | 'tasks' | 'stats';

export type BioGameMode = 'list' | 'flashcards' | 'true_false';

interface NavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  hiddenTabs?: TabType[];
  subject?: string;
  /** Удержание ~550 ms → следующий режим: список → карты → В/Н → список */
  onBioModeCycle?: () => void;
  bioGameMode?: BioGameMode;
  /** Предмет с game_modes в questions (bio, ortho, …) */
  gameModesSubject?: string;
}

const LONG_PRESS_MS = 550;

/**
 * Пункт навбара может объединять несколько экранов: «Экзамен» — это вопросы и
 * задачи, между которыми переключаются сегментами внутри активной кнопки.
 * Внутренние id экранов не меняются, поэтому доступ по модулям и оплата
 * продолжают работать как раньше.
 */
interface NavItem {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  tabs: TabType[];
}

const NAV_ITEMS: NavItem[] = [
  { key: 'lessons', label: 'Занятия', Icon: CalendarDays,   tabs: ['lessons'] },
  { key: 'exam',    label: 'Экзамен', Icon: GraduationCap,  tabs: ['questions', 'tasks'] },
  { key: 'tests',   label: 'Тест',    Icon: ClipboardList,  tabs: ['tests'] },
  { key: 'stats',   label: 'Профиль', Icon: BarChart3,      tabs: ['stats'] },
];

const TAB_SHORT_LABEL: Record<TabType, string> = {
  lessons:   'Занятия',
  questions: 'Вопросы',
  tests:     'Тест',
  tasks:     'Задачи',
  stats:     'Профиль',
};

const BIO_CYCLE: BioGameMode[] = ['list', 'flashcards', 'true_false'];

const MODE_META: Record<BioGameMode, {
  Icon: React.ComponentType<{ className?: string }>;
  ring: string;
  emoji: string;
  navLabel: string;
}> = {
  list:        { Icon: BookOpen, ring: 'hsl(210 90% 58% / 0.9)',  emoji: '📋', navLabel: 'Вопросы' },
  flashcards:  { Icon: Layers,   ring: 'hsl(142 71% 45% / 0.85)', emoji: '🎴', navLabel: 'Карты'   },
  true_false:  { Icon: Scale,    ring: 'hsl(270 65% 58% / 0.9)',  emoji: '⚖️', navLabel: 'В/Н'     },
};

export function getNextBioMode(mode: BioGameMode): BioGameMode {
  const i = BIO_CYCLE.indexOf(mode);
  return BIO_CYCLE[(i + 1) % BIO_CYCLE.length];
}

function hapticTap() {
  try {
    (window as { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  } catch { /* ignore */ }
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  hiddenTabs,
  subject,
  onBioModeCycle,
  bioGameMode = 'list',
  gameModesSubject,
}) => {
  const hidden = hiddenTabs ?? [];
  const items = NAV_ITEMS
    .map(item => ({ ...item, tabs: item.tabs.filter(t => !hidden.includes(t)) }))
    .filter(item => item.tabs.length > 0);
  if (items.length === 0) return null;

  const cycleTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId        = useRef<number | null>(null);
  const pressStartAt = useRef(0);
  const longPressFired = useRef(false);
  const pressActive    = useRef(false);

  const [holdProgress, setHoldProgress] = useState(0);
  const [hintMode, setHintMode] = useState<BioGameMode | 'none'>('none');

  const clearPressAnim = useCallback(() => {
    if (cycleTimer.current) {
      clearTimeout(cycleTimer.current);
      cycleTimer.current = null;
    }
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  const resetPressVisuals = useCallback(() => {
    setHoldProgress(0);
    setHintMode('none');
  }, []);

  const handlePressStart = useCallback((canCycle: boolean) => {
    if (!canCycle) return;

    longPressFired.current = false;
    pressActive.current = true;
    pressStartAt.current = performance.now();
    setHintMode(getNextBioMode(bioGameMode));
    setHoldProgress(0);
    clearPressAnim();

    const animate = () => {
      if (!pressActive.current) return;
      const p = Math.min(1, (performance.now() - pressStartAt.current) / LONG_PRESS_MS);
      setHoldProgress(p);
      if (p < 1) rafId.current = requestAnimationFrame(animate);
    };
    rafId.current = requestAnimationFrame(animate);

    cycleTimer.current = setTimeout(() => {
      if (!pressActive.current || longPressFired.current) return;
      longPressFired.current = true;
      hapticTap();
      onBioModeCycle?.();
      resetPressVisuals();
    }, LONG_PRESS_MS);
  }, [onBioModeCycle, bioGameMode, clearPressAnim, resetPressVisuals]);

  const handlePressEnd = useCallback(() => {
    if (!pressActive.current) return;
    pressActive.current = false;
    clearPressAnim();
    if (!longPressFired.current) resetPressVisuals();
  }, [clearPressAnim, resetPressVisuals]);

  const handleTabClick = useCallback((tabId: TabType) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onTabChange(tabId);
  }, [onTabChange]);

  useEffect(() => () => {
    pressActive.current = false;
    clearPressAnim();
  }, [clearPressAnim]);

  return (
    <div
      className="fixed left-0 right-0 px-6 z-50 flex justify-center"
      style={{ bottom: 'calc(var(--nav-bottom, 12px) + 14px)' }}
    >
      <nav
        className="flex items-center gap-1 p-1.5 rounded-full"
        style={{
          background: 'var(--c-nav-bg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--c-nav-border)',
          boxShadow: '0 10px 30px hsl(0 0% 0% / 0.28), 0 2px 6px hsl(0 0% 0% / 0.12)',
        }}
      >
        {items.map(item => {
          const isActive = item.tabs.includes(activeTab);
          const Icon = item.Icon;
          const hasSegments = item.tabs.length > 1;
          const isGameQuestions = isActive
            && activeTab === 'questions'
            && !!gameModesSubject
            && subjectHasQuestionGameModes(gameModesSubject)
            && !!onBioModeCycle;

          const displayMode: BioGameMode = hintMode !== 'none' ? hintMode : bioGameMode;
          const showBioModeIcon = isGameQuestions && (bioGameMode !== 'list' || hintMode !== 'none');
          const ModeIcon = showBioModeIcon ? MODE_META[displayMode].Icon : Icon;

          const ringMode: BioGameMode = hintMode !== 'none' ? hintMode : bioGameMode;
          const ringColor = isGameQuestions && (holdProgress > 0 || hintMode !== 'none')
            ? MODE_META[ringMode].ring
            : null;

          let ringGlow: string | undefined;
          if (ringColor) {
            const base = ringColor.replace(/\/\s*[\d.]+\)/, '/ 0.35)');
            ringGlow = holdProgress > 0
              ? `0 0 0 ${1.5 + holdProgress * 2.5}px ${ringColor}, 0 0 ${8 + holdProgress * 14}px ${base}`
              : `0 0 0 2px ${ringColor}, 0 0 14px ${base}`;
          }

          const navLabel = item.label;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                // Активный «Экзамен» переключают сегментами, а не самой кнопкой
                if (isActive && hasSegments) return;
                handleTabClick(item.tabs[0]);
              }}
              onMouseDown={() => handlePressStart(isGameQuestions)}
              onMouseUp={handlePressEnd}
              onMouseLeave={handlePressEnd}
              onTouchStart={() => handlePressStart(isGameQuestions)}
              onTouchEnd={handlePressEnd}
              onTouchCancel={handlePressEnd}
              className="relative flex flex-col items-center gap-0.5 rounded-full transition-all duration-200 select-none"
              style={{
                padding: isActive ? '9px 15px 7px 12px' : '10px 12px',
                background: isActive ? 'var(--c-primary)' : 'transparent',
                color: isActive ? 'var(--c-bg)' : 'var(--c-muted)',
                WebkitTouchCallout: 'none',
                boxShadow: ringGlow,
              }}
            >
              <span className="relative flex items-center gap-1.5">
                <ModeIcon className={`w-[18px] h-[18px] ${hintMode !== 'none' ? 'animate-in zoom-in duration-200' : ''}`} />
                {hintMode !== 'none' && isGameQuestions && (
                  <span
                    className="absolute -top-1.5 -right-2 text-[10px] leading-none animate-in zoom-in duration-150"
                    aria-hidden
                  >
                    {MODE_META[hintMode].emoji}
                  </span>
                )}
                {isActive && (
                  <span className="text-[12.5px] font-bold whitespace-nowrap animate-in fade-in slide-in-from-left-1 duration-200">
                    {navLabel}
                  </span>
                )}
              </span>

              {isActive && hasSegments && (
                <span className="flex items-center gap-0.5">
                  {item.tabs.map(t => {
                    const segActive = t === activeTab;
                    const segLabel = t === 'questions' && bioGameMode !== 'list'
                      ? MODE_META[bioGameMode].navLabel
                      : TAB_SHORT_LABEL[t];
                    return (
                      <span
                        key={t}
                        role="button"
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation();
                          onTabChange(t);
                        }}
                        className="text-[10.5px] font-bold leading-tight rounded-full transition-opacity duration-200"
                        style={{
                          padding: '1px 6px',
                          background: segActive
                            ? 'color-mix(in srgb, var(--c-bg) 30%, transparent)'
                            : 'transparent',
                          opacity: segActive ? 1 : 0.5,
                        }}
                      >
                        {segLabel}
                      </span>
                    );
                  })}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
