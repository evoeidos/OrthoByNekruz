"use client";

import React, { useCallback, useRef, useState } from 'react';

const DOT_COUNT = 9;
const DOT_RADIUS = 7;
const HIT_RADIUS = 26;
const CELL = 68;
const PAD = 40;
const SIZE = PAD * 2 + CELL * 2;

function dotCenter(index: number): { x: number; y: number } {
  const i = index - 1;
  const row = Math.floor(i / 3);
  const col = i % 3;
  return { x: PAD + col * CELL, y: PAD + row * CELL };
}

function nearestDot(x: number, y: number): number | null {
  for (let n = 1; n <= DOT_COUNT; n++) {
    const c = dotCenter(n);
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return n;
  }
  return null;
}

function patternsEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type Theme = {
  accent: string;
  accentSoft: string;
  border: string;
  textMuted: string;
  danger: string;
  surfaceAlt: string;
};

export function AdminPatternLock({
  expectedPattern,
  onSuccess,
  onFail,
  disabled,
  theme,
}: {
  expectedPattern: number[];
  onSuccess: () => void;
  onFail?: () => void;
  disabled?: boolean;
  theme: Theme;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const patternRef = useRef<number[]>([]);
  const [pattern, setPattern] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const reset = useCallback(() => {
    patternRef.current = [];
    setPattern([]);
    setDragging(false);
    setCursor(null);
  }, []);

  const syncPattern = useCallback((next: number[]) => {
    patternRef.current = next;
    setPattern(next);
  }, []);

  const addDot = useCallback((dot: number, prev: number[]) => {
    if (prev.includes(dot)) return prev;
    return [...prev, dot];
  }, []);

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const finishPattern = useCallback((finalPattern: number[]) => {
    if (patternsEqual(finalPattern, expectedPattern)) {
      setFailed(false);
      reset();
      onSuccess();
      return;
    }
    setFailed(true);
    onFail?.();
    window.setTimeout(() => {
      setFailed(false);
      reset();
    }, 450);
  }, [expectedPattern, onFail, onSuccess, reset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    const dot = nearestDot(pt.x, pt.y);
    if (!dot) return;
    setFailed(false);
    setDragging(true);
    syncPattern([dot]);
    setCursor(pt);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || disabled) return;
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    setCursor(pt);
    const dot = nearestDot(pt.x, pt.y);
    if (dot) syncPattern(addDot(dot, patternRef.current));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging || disabled) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
    setDragging(false);
    setCursor(null);
    const finalPattern = patternRef.current;
    if (finalPattern.length >= expectedPattern.length) {
      finishPattern(finalPattern);
    } else {
      setFailed(true);
      onFail?.();
      window.setTimeout(() => {
        setFailed(false);
        reset();
      }, 450);
    }
  };

  const lineColor = failed ? theme.danger : theme.accent;
  const activeDot = failed ? theme.danger : theme.accent;
  const idleRing = theme.border;

  const points = pattern.map(dotCenter);
  const trail = cursor && dragging && points.length
    ? [...points, cursor]
    : points;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: SIZE,
          height: SIZE,
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <svg width={SIZE} height={SIZE} style={{ display: 'block' }}>
          {trail.length >= 2 && (
            <polyline
              points={trail.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={lineColor}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={failed ? 0.85 : 1}
            />
          )}
          {Array.from({ length: DOT_COUNT }, (_, i) => {
            const n = i + 1;
            const { x, y } = dotCenter(n);
            const active = pattern.includes(n);
            return (
              <g key={n}>
                <circle
                  cx={x}
                  cy={y}
                  r={HIT_RADIUS}
                  fill="transparent"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={DOT_RADIUS + 5}
                  fill={active ? (failed ? `${theme.danger}22` : theme.accentSoft) : theme.surfaceAlt}
                  stroke={active ? activeDot : idleRing}
                  strokeWidth={active ? 2 : 1.5}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={active ? DOT_RADIUS + 1 : DOT_RADIUS}
                  fill={active ? activeDot : theme.textMuted}
                  opacity={active ? 1 : 0.35}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{
        fontSize: 12,
        color: failed ? theme.danger : theme.textMuted,
        minHeight: 18,
        textAlign: 'center',
      }}>
        {failed ? 'Неверный ключ — попробуй снова' : 'Нарисуй графический ключ'}
      </div>
    </div>
  );
}

export const ADMIN_PATTERN = [2, 4, 5, 8, 6] as const;

// ВНИМАНИЕ: это НЕ граница безопасности.
// Значение попадает в клиентский бандл, поэтому любой может его извлечь.
// Реальная проверка прав админа — на сервере (src/lib/adminAuth.ts):
// подпись Telegram initData + совпадение user.id с ADMIN_TG_ID.
// Графический ключ и этот секрет — только UX-гейт от случайного захода.
// Значение должно совпадать с серверным ADMIN_SECRET; задаётся через env,
// чтобы можно было ротировать без правки кода.
export const ADMIN_UNLOCK_SECRET =
  process.env.NEXT_PUBLIC_ADMIN_SECRET || 'ortho2000secret';
