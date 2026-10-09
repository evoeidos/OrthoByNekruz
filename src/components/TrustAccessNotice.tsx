"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Clock, X } from 'lucide-react';

const EXIT_MS = 420;

function formatUntil(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatRemaining(iso: string): string | null {
  const diff = Date.parse(iso) - Date.now();
  if (diff <= 0) return null;
  const min = Math.ceil(diff / 60_000);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${min} мин`;
}

interface TrustAccessNoticeProps {
  visible: boolean;
  expiresAtIso?: string | null;
  onDismiss?: () => void;
}

export const TrustAccessNotice: React.FC<TrustAccessNoticeProps> = ({
  visible,
  expiresAtIso,
  onDismiss,
}) => {
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const t = setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [visible, mounted]);

  useEffect(() => {
    if (!mounted || !expiresAtIso) return;
    const iv = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(iv);
  }, [mounted, expiresAtIso]);

  const timeLabel = useMemo(() => {
    if (!expiresAtIso) return null;
    void tick;
    const until = formatUntil(expiresAtIso);
    const left = formatRemaining(expiresAtIso);
    return left ? `до ${until} · осталось ${left}` : `до ${until}`;
  }, [expiresAtIso, tick]);

  if (!mounted) return null;

  return (
    <div
      className="fixed left-0 right-0 z-[55] flex justify-center px-5 pointer-events-none"
      style={{ bottom: 'calc(var(--scroll-pb, 100px) - 4px)' }}
      role="status"
      aria-live="polite"
    >
      <div
        className={[
          'pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3.5 shadow-2xl',
          'transition-all ease-out',
          exiting
            ? 'opacity-0 translate-y-5 scale-[0.97] duration-[420ms]'
            : 'trust-notice-in opacity-100 translate-y-0 scale-100 duration-[380ms]',
        ].join(' ')}
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          boxShadow: '0 12px 40px hsl(0 0% 0% / 0.35), 0 0 0 1px hsl(0 0% 100% / 0.04)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
          >
            <Clock className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--c-text)' }}>
              Временный доступ открыт
            </p>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--c-muted)' }}>
              {timeLabel
                ? `${timeLabel} — пока админ проверяет оплату`
                : 'Пока админ проверяет оплату — доступ на 1 час'}
            </p>
          </div>
          {onDismiss && (
            <button
              type="button"
              aria-label="Скрыть"
              onClick={onDismiss}
              className="shrink-0 rounded-lg p-1.5 transition duration-150 active:scale-90"
              style={{ color: 'var(--c-muted)' }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
