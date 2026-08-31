"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { TabType } from '@/components/Navigation';
import {
  COACH_TOUR_DISMISS_ON_BACKDROP,
  COACH_TOUR_RESTART_EVENT,
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
  blocked?: boolean;
  hiddenTabs?: TabType[];
  activeTab?: TabType;
  onHighlightTab?: (tab: TabType) => void;
  dismissOnBackdrop?: boolean;
}

const TAB_SWITCH_MS = 300;
const HOLE_SPRING = { type: 'spring' as const, stiffness: 340, damping: 28, mass: 0.85 };
const HOLE_SPRING_SNAPPY = { type: 'spring' as const, stiffness: 460, damping: 34, mass: 0.7 };

function haptic(kind: 'light' | 'medium' | 'selection' = 'light') {
  try {
    const hapticApi = (window as {
      Telegram?: {
        WebApp?: {
          HapticFeedback?: {
            impactOccurred: (s: string) => void;
            selectionChanged: () => void;
          };
        };
      };
    }).Telegram?.WebApp?.HapticFeedback;
    if (!hapticApi) return;
    if (kind === 'selection') hapticApi.selectionChanged();
    else hapticApi.impactOccurred(kind);
  } catch { /* ignore */ }
}

type TgBackButton = {
  show: () => void;
  hide: () => void;
  onClick: (fn: () => void) => void;
  offClick: (fn: () => void) => void;
};

function telegramBackButton(): TgBackButton | null {
  try {
    return (window as { Telegram?: { WebApp?: { BackButton?: TgBackButton } } })
      .Telegram?.WebApp?.BackButton ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { window.setTimeout(resolve, ms); });
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
  for (let i = 0; i < 20; i++) {
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

function StepProgress({ steps, stepIndex, reduced }: {
  steps: CoachStep[];
  stepIndex: number;
  reduced: boolean;
}) {
  return (
    <div className="mb-3 flex items-center gap-1.5">
      {steps.map((s, i) => (
        <motion.div
          key={s.id}
          className="h-1 flex-1 rounded-full origin-center"
          initial={false}
          animate={{
            scaleY: i === stepIndex && !reduced ? 1.55 : 1,
            background: i <= stepIndex
              ? 'var(--c-primary)'
              : 'color-mix(in srgb, var(--c-border) 85%, transparent)',
            opacity: i < stepIndex ? 0.55 : 1,
          }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        />
      ))}
    </div>
  );
}

export const CoachTour: React.FC<CoachTourProps> = ({
  blocked = false,
  hiddenTabs = [],
  activeTab,
  onHighlightTab,
  dismissOnBackdrop = COACH_TOUR_DISMISS_ON_BACKDROP,
}) => {
  const reducedMotion = useReducedMotion();
  const steps = useMemo(
    () => COACH_TOUR_STEPS.filter(s => stepAvailable(s, hiddenTabs)),
    [hiddenTabs],
  );

  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [contentReady, setContentReady] = useState(false);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const closedRef = useRef(false);
  const startedRef = useRef(false);
  const startTabRef = useRef<TabType | null>(null);
  const activeTabRef = useRef(activeTab);
  const slideDirRef = useRef(1);
  const [holeBooting, setHoleBooting] = useState(true);
  activeTabRef.current = activeTab;

  const step: CoachStep | undefined = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;

  const measureLayout = useCallback((): Layout | null => {
    const el = targetRef.current;
    const tooltip = tooltipRef.current;
    if (!el || !tooltip) return null;
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
    return {
      hole,
      tooltip: { left: placed.left, top: placed.top, width: tw, maxHeight },
      placement: placed.placement,
      arrowOffset: placed.arrowOffset,
    };
  }, []);

  const finish = useCallback((restoreTab: boolean) => {
    if (closedRef.current) return;
    closedRef.current = true;
    markCoachTourSeen();
    setContentReady(false);
    setExiting(true);
    window.setTimeout(() => {
      setOpen(false);
      setExiting(false);
      setLayout(null);
      setHoleBooting(true);
      if (restoreTab && startTabRef.current) {
        onHighlightTab?.(startTabRef.current);
      }
    }, reducedMotion ? 80 : 260);
  }, [onHighlightTab, reducedMotion]);

  const skip = useCallback(() => {
    haptic('medium');
    finish(true);
  }, [finish]);

  const goStep = useCallback((delta: 1 | -1) => {
    slideDirRef.current = delta;
    haptic('selection');
    setContentReady(false);
    setStepIndex(i => Math.min(steps.length - 1, Math.max(0, i + delta)));
  }, [steps.length]);

  const next = useCallback(() => {
    if (isLast) {
      haptic('medium');
      finish(true);
      return;
    }
    goStep(1);
  }, [finish, goStep, isLast]);

  const prev = useCallback(() => {
    if (stepIndex <= 0) return;
    goStep(-1);
  }, [goStep, stepIndex]);

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
      setHoleBooting(true);
      setStepIndex(0);
      setOpen(true);
    }, 420);
    return () => window.clearTimeout(t);
  }, [blocked, steps.length]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open || blocked || !step) return;
    let cancelled = false;

    const run = async () => {
      if (step.tab) {
        onHighlightTab?.(step.tab);
        await sleep(TAB_SWITCH_MS);
      }
      if (cancelled) return;
      const el = await findTarget(coachSelector(step.target));
      if (cancelled) return;
      if (!el) {
        if (stepIndex < steps.length - 1) setStepIndex(i => i + 1);
        else finish(true);
        return;
      }
      targetRef.current = el;
      await revealTarget(el);
      if (cancelled) return;
      const nextLayout = measureLayout();
      if (cancelled || !nextLayout) return;
      setLayout(nextLayout);
      await sleep(reducedMotion ? 0 : 60);
      if (!cancelled) setContentReady(true);
    };

    void run();
    return () => { cancelled = true; };
  }, [open, blocked, step, stepIndex, steps.length, onHighlightTab, finish, measureLayout, reducedMotion]);

  useEffect(() => {
    const begin = () => {
      if (blocked) return;
      closedRef.current = false;
      startedRef.current = true;
      startTabRef.current = activeTabRef.current ?? null;
      setHoleBooting(true);
      slideDirRef.current = 1;
      setExiting(false);
      setLayout(null);
      setContentReady(false);
      setStepIndex(0);
      setOpen(true);
    };
    window.addEventListener(COACH_TOUR_RESTART_EVENT, begin);
    return () => window.removeEventListener(COACH_TOUR_RESTART_EVENT, begin);
  }, [blocked]);

  useEffect(() => {
    if (!open || !layout) return;
    const t = window.setTimeout(() => setHoleBooting(false), reducedMotion ? 60 : 480);
    return () => clearTimeout(t);
  }, [open, layout, reducedMotion]);

  useEffect(() => {
    if (!open) return;
    const back = telegramBackButton();
    if (!back) return;
    if (stepIndex <= 0) {
      try { back.hide(); } catch { /* ignore */ }
      return;
    }
    const onBack = () => prev();
    try {
      back.show();
      back.onClick(onBack);
    } catch { /* ignore */ }
    return () => {
      try {
        back.offClick(onBack);
        back.hide();
      } catch { /* ignore */ }
    };
  }, [open, prev, stepIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, skip, next, prev]);

  useLayoutEffect(() => {
    if (!open || !contentReady) return;
    const nextLayout = measureLayout();
    if (nextLayout) setLayout(nextLayout);
  }, [open, contentReady, stepIndex, measureLayout]);

  useEffect(() => {
    if (!open || !contentReady) return;
    const onChange = () => {
      const nextLayout = measureLayout();
      if (nextLayout) setLayout(nextLayout);
    };
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
  }, [open, contentReady, measureLayout]);

  if (typeof document === 'undefined') return null;
  if (blocked || !open || !step) return null;

  const slideDir = slideDirRef.current;
  const holeTransition = reducedMotion ? { duration: 0.2 } : HOLE_SPRING;

  const tooltipVariants = reducedMotion
    ? {
        enter: { opacity: 1 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (d: number) => ({ opacity: 0, y: d * 22, scale: 0.94, filter: 'blur(4px)' }),
        center: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
        exit: (d: number) => ({ opacity: 0, y: d * -14, scale: 0.97, filter: 'blur(2px)' }),
      };

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[120]"
      style={{ overscrollBehavior: 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-tour-title"
      initial={false}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: reducedMotion ? 0.08 : 0.24 }}
    >
      <div
        className="absolute inset-0 overflow-hidden"
        onClick={onBackdrop}
        role={dismissOnBackdrop ? 'button' : undefined}
        tabIndex={dismissOnBackdrop ? 0 : undefined}
        aria-label={dismissOnBackdrop ? 'Закрыть подсказку' : undefined}
      >
        {layout ? (
          <motion.div
            className="absolute"
            initial={holeBooting && !reducedMotion
              ? { opacity: 0, scale: 0.88 }
              : false}
            animate={{
              top: layout.hole.top,
              left: layout.hole.left,
              width: layout.hole.width,
              height: layout.hole.height,
              borderRadius: layout.hole.radius,
              opacity: 1,
              scale: 1,
            }}
            transition={holeTransition}
            style={{
              boxShadow: '0 0 0 9999px rgba(8, 12, 10, 0.76)',
              outline: '2px solid var(--c-primary)',
              pointerEvents: 'none',
            }}
          >
            {!reducedMotion && (
              <motion.span
                className="absolute inset-0 pointer-events-none"
                style={{
                  borderRadius: 'inherit',
                  boxShadow: '0 0 0 2px color-mix(in srgb, var(--c-primary) 55%, transparent), 0 0 22px color-mix(in srgb, var(--c-primary) 35%, transparent)',
                }}
                animate={{ opacity: [0.45, 1, 0.45], scale: [1, 1.06, 1] }}
                transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(8, 12, 10, 0.76)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </div>

      <motion.div
        ref={tooltipRef}
        className="absolute z-[1] flex flex-col"
        animate={{
          left: layout?.tooltip.left ?? -9999,
          top: layout?.tooltip.top ?? 0,
        }}
        transition={reducedMotion ? { duration: 0.15 } : HOLE_SPRING_SNAPPY}
        style={{
          width: layout?.tooltip.width ?? Math.min(340, typeof window !== 'undefined' ? window.innerWidth - 24 : 320),
          maxHeight: layout?.tooltip.maxHeight,
          visibility: layout ? 'visible' : 'hidden',
          pointerEvents: contentReady ? 'auto' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        {layout?.placement === 'below' && contentReady && (
          <motion.span
            aria-hidden
            className="absolute -top-2 h-4 w-4 rotate-45"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              left: layout.arrowOffset - 8,
              background: 'var(--c-card)',
              borderLeft: '1px solid var(--c-border)',
              borderTop: '1px solid var(--c-border)',
            }}
          />
        )}

        <AnimatePresence mode="wait" custom={slideDir}>
          {contentReady && (
            <motion.div
              key={step.id}
              custom={slideDir}
              variants={tooltipVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={reducedMotion
                ? { duration: 0.12 }
                : { type: 'spring', stiffness: 440, damping: 32 }}
              className="relative flex min-h-0 max-h-full flex-col overflow-hidden rounded-[22px] p-4"
              style={{
                background: 'var(--c-card)',
                color: 'var(--c-text)',
                border: '1px solid var(--c-border)',
                boxShadow: '0 16px 40px hsl(0 0% 0% / 0.28)',
              }}
            >
              <StepProgress steps={steps} stepIndex={stepIndex} reduced={!!reducedMotion} />

              <div className="mb-2 flex items-start gap-3">
                <motion.span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-[20px]"
                  style={{ background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary-br)' }}
                  initial={reducedMotion ? false : { rotate: -12, scale: 0.6 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                >
                  {step.emoji}
                </motion.span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p id="coach-tour-title" className="text-[15px] font-bold leading-tight">
                      {step.title}
                    </p>
                    <span
                      className="shrink-0 text-[11px] font-semibold tabular-nums"
                      style={{ color: 'var(--c-muted)' }}
                    >
                      {stepIndex + 1}/{steps.length}
                    </span>
                  </div>
                  <p
                    className="mt-1.5 min-h-0 overflow-y-auto text-[13.5px] leading-relaxed"
                    style={{ color: 'var(--c-muted)' }}
                  >
                    {step.body}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {!isLast && (
                  <button
                    type="button"
                    onClick={skip}
                    className="h-11 min-w-[44px] flex-1 rounded-2xl text-[13px] font-semibold active:scale-[0.97] transition-transform"
                    style={{
                      background: 'transparent',
                      color: 'var(--c-muted)',
                      border: '1px solid var(--c-border)',
                    }}
                  >
                    Пропустить
                  </button>
                )}
                <motion.button
                  type="button"
                  onClick={next}
                  whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                  className="h-11 min-w-[44px] flex-[1.4] rounded-2xl text-[13px] font-bold"
                  style={{
                    background: 'var(--c-primary)',
                    color: 'var(--c-bg)',
                    boxShadow: isLast
                      ? '0 8px 24px color-mix(in srgb, var(--c-primary) 40%, transparent)'
                      : undefined,
                  }}
                >
                  {isLast ? 'Понятно ✨' : 'Далее →'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {layout?.placement === 'above' && contentReady && (
          <motion.span
            aria-hidden
            className="absolute -bottom-2 h-4 w-4 rotate-45"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              left: layout.arrowOffset - 8,
              background: 'var(--c-card)',
              borderRight: '1px solid var(--c-border)',
              borderBottom: '1px solid var(--c-border)',
            }}
          />
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
};
