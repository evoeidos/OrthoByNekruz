"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { TabType } from '@/components/Navigation';
import {
  COACH_TOUR_DISMISS_ON_BACKDROP,
  COACH_TOUR_STEPS,
  coachSelector,
  getVisualViewportBox,
  hasSeenCoachTour,
  holeFromElement,
  isElementInVisualViewport,
  markCoachTourSeen,
  placeTooltip,
  readSafePadding,
  stepAvailable,
  type CoachBox,
  type CoachPlacement,
  type CoachStep,
} from '@/lib/coachTour';

type Layout = {
  hole: CoachBox & { radius: number };
  tooltip: { left: number; top: number; width: number; maxHeight: number };
  placement: CoachPlacement;
  arrowOffset: number;
};

interface CoachTourProps {
  /** Не стартовать, пока поверх висят приветствие / хинт группы / чек. */
  blocked?: boolean;
  hiddenTabs?: TabType[];
  activeTab?: TabType;
  /** Переключить нижний таб, чтобы подсвеченная кнопка стала активной. */
  onHighlightTab?: (tab: TabType) => void;
  /**
   * Закрывать тур кликом по затемнению.
   * По умолчанию — только кнопки («Пропустить» / «Далее» / «Понятно»).
   */
  dismissOnBackdrop?: boolean;
}

function haptic(kind: 'light' | 'medium' = 'light') {
  try {
    (window as { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback?.impactOccurred(kind);
  } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function waitForScrollIdle(ms = 420): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('scroll', onScroll, true);
      resolve();
    };
    let timer = window.setTimeout(finish, ms);
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, 140);
    };
    window.addEventListener('scroll', onScroll, true);
  });
}

async function findTarget(selector: string): Promise<HTMLElement | null> {
  for (let i = 0; i < 16; i++) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement && el.getClientRects().length > 0) return el;
    await sleep(40);
  }
  return null;
}

async function revealTarget(el: HTMLElement): Promise<void> {
  if (isElementInVisualViewport(el, 10)) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  await waitForScrollIdle();
}

export const CoachTour: React.FC<CoachTourProps> = ({
  blocked = false,
  hiddenTabs = [],
  activeTab,
  onHighlightTab,
  dismissOnBackdrop = COACH_TOUR_DISMISS_ON_BACKDROP,
}) => {
  const steps = useMemo(
    () => COACH_TOUR_STEPS.filter(s => stepAvailable(s, hiddenTabs)),
    [hiddenTabs],
  );

  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [ready, setReady] = useState(false);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const closedRef = useRef(false);
  const startedRef = useRef(false);
  const startTabRef = useRef<TabType | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const step: CoachStep | undefined = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;

  const finish = useCallback((restoreTab: boolean) => {
    if (closedRef.current) return;
    closedRef.current = true;
    markCoachTourSeen();
    setOpen(false);
    setLayout(null);
    if (restoreTab && startTabRef.current) {
      onHighlightTab?.(startTabRef.current);
    }
  }, [onHighlightTab]);

  const skip = useCallback(() => {
    haptic('medium');
    finish(true);
  }, [finish]);

  const next = useCallback(() => {
    haptic('light');
    if (isLast) {
      finish(true);
      return;
    }
    setReady(false);
    setLayout(null);
    setStepIndex(i => i + 1);
  }, [finish, isLast]);

  const onBackdrop = useCallback(() => {
    if (!dismissOnBackdrop) return;
    haptic('medium');
    finish(true);
  }, [dismissOnBackdrop, finish]);

  useEffect(() => {
    if (blocked || startedRef.current || closedRef.current) return;
    if (hasSeenCoachTour() || steps.length === 0) return;
    const t = window.setTimeout(() => {
      if (closedRef.current || startedRef.current || hasSeenCoachTour()) return;
      startedRef.current = true;
      startTabRef.current = activeTabRef.current ?? null;
      setStepIndex(0);
      setOpen(true);
    }, 420);
    return () => window.clearTimeout(t);
  }, [blocked, steps.length]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || blocked || !step) return;
    let cancelled = false;

    const run = async () => {
      if (step.tab) {
        onHighlightTab?.(step.tab);
        await sleep(220);
      }
      if (cancelled) return;
      const el = await findTarget(coachSelector(step.target));
      if (cancelled) return;
      if (!el) {
        if (stepIndex < steps.length - 1) {
          setStepIndex(i => i + 1);
        } else {
          finish(true);
        }
        return;
      }
      targetRef.current = el;
      await revealTarget(el);
      if (cancelled) return;
      setLayout(null);
      setReady(true);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, blocked, step, stepIndex, steps.length, onHighlightTab, finish]);

  const measure = useCallback(() => {
    const el = targetRef.current;
    const tooltip = tooltipRef.current;
    if (!el || !tooltip) return;
    const hole = holeFromElement(el);
    const viewport = getVisualViewportBox();
    const padding = readSafePadding();
    const maxWidth = Math.min(340, Math.max(240, viewport.width - padding.left - padding.right));
    const maxHeight = Math.max(120, viewport.height - padding.top - padding.bottom);
    tooltip.style.width = `${maxWidth}px`;
    tooltip.style.maxHeight = `${maxHeight}px`;
    const tw = tooltip.offsetWidth || maxWidth;
    const th = tooltip.offsetHeight || 160;
    const placed = placeTooltip({
      target: hole,
      tooltip: { width: tw, height: th },
      viewport,
      padding,
      gap: 14,
    });
    setLayout({
      hole,
      tooltip: { left: placed.left, top: placed.top, width: tw, maxHeight },
      placement: placed.placement,
      arrowOffset: placed.arrowOffset,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || !ready) return;
    measure();
  }, [open, ready, stepIndex, measure]);

  useEffect(() => {
    if (!open || !ready) return;
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onChange);
    vv?.addEventListener('scroll', onChange);
    const tg = (window as { Telegram?: { WebApp?: { onEvent?: (e: string, cb: () => void) => void; offEvent?: (e: string, cb: () => void) => void } } }).Telegram?.WebApp;
    try { tg?.onEvent?.('viewportChanged', onChange); } catch { /* ignore */ }
    try { tg?.onEvent?.('safeAreaChanged', onChange); } catch { /* ignore */ }
    try { tg?.onEvent?.('contentSafeAreaChanged', onChange); } catch { /* ignore */ }
    return () => {
      window.removeEventListener('resize', onChange);
      vv?.removeEventListener('resize', onChange);
      vv?.removeEventListener('scroll', onChange);
      try { tg?.offEvent?.('viewportChanged', onChange); } catch { /* ignore */ }
      try { tg?.offEvent?.('safeAreaChanged', onChange); } catch { /* ignore */ }
      try { tg?.offEvent?.('contentSafeAreaChanged', onChange); } catch { /* ignore */ }
    };
  }, [open, ready, measure]);

  if (typeof document === 'undefined') return null;
  if (blocked || !open || !step) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120]"
      style={{ overscrollBehavior: 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-tour-title"
    >
      <div
        className="absolute inset-0 overflow-hidden"
        onClick={onBackdrop}
        role={dismissOnBackdrop ? 'button' : undefined}
        tabIndex={dismissOnBackdrop ? 0 : undefined}
        aria-label={dismissOnBackdrop ? 'Закрыть подсказку' : undefined}
      >
        <AnimatePresence>
          {layout && (
            <motion.div
              key={step.id}
              className="absolute"
              initial={false}
              animate={{
                top: layout.hole.top,
                left: layout.hole.left,
                width: layout.hole.width,
                height: layout.hole.height,
              }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              style={{
                borderRadius: layout.hole.radius,
                boxShadow: '0 0 0 9999px rgba(8, 12, 10, 0.72)',
                outline: '2px solid var(--c-primary)',
                pointerEvents: 'none',
              }}
            />
          )}
        </AnimatePresence>
        {!layout && (
          <div className="absolute inset-0" style={{ background: 'rgba(8, 12, 10, 0.72)' }} />
        )}
      </div>

      <div
        ref={tooltipRef}
        className="absolute z-[1] flex flex-col"
        style={{
          left: layout?.tooltip.left ?? -9999,
          top: layout?.tooltip.top ?? 0,
          width: layout?.tooltip.width ?? Math.min(340, typeof window !== 'undefined' ? window.innerWidth - 24 : 320),
          maxHeight: layout?.tooltip.maxHeight,
          visibility: layout ? 'visible' : 'hidden',
          pointerEvents: layout ? 'auto' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        {layout?.placement === 'below' && (
          <span
            aria-hidden
            className="absolute -top-2 h-4 w-4 rotate-45"
            style={{
              left: layout.arrowOffset - 8,
              background: 'var(--c-card)',
              borderLeft: '1px solid var(--c-border)',
              borderTop: '1px solid var(--c-border)',
            }}
          />
        )}
        <div
          className="relative flex min-h-0 max-h-full flex-col overflow-hidden rounded-[22px] p-4"
          style={{
            background: 'var(--c-card)',
            color: 'var(--c-text)',
            border: '1px solid var(--c-border)',
            boxShadow: '0 16px 40px hsl(0 0% 0% / 0.28)',
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p
              id="coach-tour-title"
              className="text-[15px] font-bold leading-tight"
            >
              {step.title}
            </p>
            <span
              className="shrink-0 text-[11px] font-semibold tabular-nums"
              style={{ color: 'var(--c-muted)' }}
            >
              {stepIndex + 1} / {steps.length}
            </span>
          </div>
          <p
            className="min-h-0 overflow-y-auto text-[13.5px] leading-relaxed"
            style={{ color: 'var(--c-muted)' }}
          >
            {step.body}
          </p>
          <div className="mt-4 flex items-center gap-2">
            {!isLast && (
              <button
                type="button"
                onClick={skip}
                className="h-11 min-w-[44px] flex-1 rounded-2xl text-[13px] font-semibold"
                style={{
                  background: 'transparent',
                  color: 'var(--c-muted)',
                  border: '1px solid var(--c-border)',
                }}
              >
                Пропустить
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="h-11 min-w-[44px] flex-[1.4] rounded-2xl text-[13px] font-bold"
              style={{
                background: 'var(--c-primary)',
                color: 'var(--c-bg)',
              }}
            >
              {isLast ? 'Понятно' : 'Далее'}
            </button>
          </div>
        </div>
        {layout?.placement === 'above' && (
          <span
            aria-hidden
            className="absolute -bottom-2 h-4 w-4 rotate-45"
            style={{
              left: layout.arrowOffset - 8,
              background: 'var(--c-card)',
              borderRight: '1px solid var(--c-border)',
              borderBottom: '1px solid var(--c-border)',
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
};
