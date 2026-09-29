"use client";

import React, { useEffect, useMemo, useState } from 'react';
import type { UniData } from '@/lib/uniHelpers';
import {
  krasnoyarskNow, currentWeekDays, parseTimeRange, datesIncludeToday, findMatchingDateEntry, MONTHS_GEN,
} from '@/lib/uniHelpers';
import { UniLockedCard } from './UniLockedCard';

/** Время по Красноярску, обновляется каждые 30 с. */
function useKrskNow() {
  const [now, setNow] = useState(() => krasnoyarskNow());
  useEffect(() => {
    const t = setInterval(() => setNow(krasnoyarskNow()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const LESSON_COLORS = ['var(--c-primary)', 'var(--c-info)', 'var(--c-amber)'];

export const UniScheduleTab: React.FC<{ uni: UniData; onBind: () => void }> = ({ uni, onBind }) => {
  const now = useKrskNow();
  const week = useMemo(() => currentWeekDays(), [now.weekdayIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<string | null>(null);

  if (!uni.bound) return <UniLockedCard title="Расписание не подключено" loading={uni.checking || uni.loading} onBind={onBind} />;
  if (uni.loading) return <UniLockedCard title="" loading onBind={onBind} />;
  if (uni.schedule.length === 0) {
    return (
      <p className="text-[12.5px] text-center py-6" style={{ color: 'var(--c-muted)' }}>
        Нет данных расписания (возможно, сайт изменил вёрстку).
      </p>
    );
  }

  const selected = picked ?? now.weekday;
  const isToday = selected === now.weekday;
  const day = uni.schedule.find(d => d.weekday === selected);
  const lessons = day?.lessons ?? [];

  const today = { day: now.date.getUTCDate(), month: now.date.getUTCMonth() };
  const selDate = week.find(w => w.weekday === selected);

  const withState = lessons.map(l => {
    const dateEntry = selDate ? findMatchingDateEntry(l.dates, { day: selDate.num, month: selDate.month }) : null;
    return {
      l,
      range: parseTimeRange(l.time),
      dateMatch: datesIncludeToday(l.dates, today),
      topic: dateEntry ? uni.topics[l.subject]?.[dateEntry] : undefined,
    };
  });
  const nextIdx = isToday
    ? withState.findIndex(x => x.dateMatch && x.range && x.range[0] > now.minutes)
    : -1;

  const dateLabel = selDate
    ? `${selected}, ${selDate.num} ${MONTHS_GEN[selDate.month]}`
    : selected;

  return (
    <>
      <div className="grid grid-cols-6 gap-1">
        {week.map(w => {
          const active = w.weekday === selected;
          const today = w.weekday === now.weekday;
          const has = uni.schedule.find(d => d.weekday === w.weekday)?.lessons.length;
          return (
            <button
              key={w.weekday}
              type="button"
              onClick={() => setPicked(w.weekday)}
              className="rounded-[12px] py-2 text-center active:scale-95 transition-transform"
              style={{
                background: active ? 'var(--c-primary)' : 'var(--c-card)',
                color: active ? 'var(--c-bg)' : 'var(--c-text)',
                border: `1px solid ${today && !active ? 'var(--c-primary)' : 'var(--c-border)'}`,
              }}
            >
              <div className="text-[10px] font-bold opacity-80">{w.short}</div>
              <div className="text-[15px] font-bold mt-0.5">{w.num}</div>
              <div
                className="w-1 h-1 rounded-full mx-auto mt-1"
                style={{ background: has ? (active ? 'var(--c-bg)' : 'var(--c-primary)') : 'transparent' }}
              />
            </button>
          );
        })}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-widest px-1 pt-1" style={{ color: 'var(--c-muted)' }}>
        {dateLabel} · {lessons.length} {lessons.length === 1 ? 'пара' : lessons.length < 5 ? 'пары' : 'пар'}
      </div>

      {lessons.length === 0 && (
        <p className="text-[12.5px] text-center py-6" style={{ color: 'var(--c-muted)' }}>Занятий нет.</p>
      )}

      {withState.map(({ l, range, dateMatch, topic }, i) => {
        const live = isToday && dateMatch && !!range && now.minutes >= range[0] && now.minutes < range[1];
        const past = isToday && dateMatch && !!range && now.minutes >= range[1];
        const next = !live && i === nextIdx;
        const badge = live && range
          ? `Идёт сейчас · ещё ${range[1] - now.minutes} мин`
          : next && range ? `Далее · через ${range[0] - now.minutes} мин` : '';
        const pct = live && range ? Math.round(((now.minutes - range[0]) / (range[1] - range[0])) * 100) : 0;
        const meta = [l.type, l.room, l.teacher].filter(Boolean).join(' · ');
        return (
          <div
            key={i}
            className="flex gap-3 rounded-[16px] px-3.5 py-3"
            style={{
              background: live ? 'var(--c-primary-soft)' : 'var(--c-card)',
              border: live ? '1.5px solid var(--c-primary)' : '1px solid var(--c-border)',
              opacity: past ? 0.5 : 1,
            }}
          >
            <div className="w-[52px] flex-shrink-0 font-mono text-[12px] font-bold leading-snug" style={{ color: 'var(--c-muted)' }}>
              {(l.time || '').split(/\s*[\/–-]\s*/).map((t, ti) => <div key={ti}>{t}</div>)}
            </div>
            <div className="w-[3px] rounded-full flex-shrink-0" style={{ background: LESSON_COLORS[i % 3] }} />
            <div className="flex-1 min-w-0 flex flex-col">
              {badge && (
                <span
                  className="self-start text-[10.5px] font-bold px-2 py-0.5 rounded-full mb-1.5"
                  style={{
                    background: live ? 'var(--c-primary)' : 'var(--c-bg-subtle)',
                    color: live ? 'var(--c-bg)' : 'var(--c-muted)',
                  }}
                >
                  {badge}
                </span>
              )}
              <div className="text-[14px] font-bold leading-snug" style={{ color: 'var(--c-text)' }}>{l.subject}</div>
              {topic && (
                <div className="text-[12.5px] mt-1 leading-snug" style={{ color: 'var(--c-text)' }}>
                  <span className="font-bold" style={{ color: 'var(--c-primary)' }}>№{topic.seq}</span> {topic.topic}
                </div>
              )}
              {meta && <div className="text-[12px] mt-0.5" style={{ color: 'var(--c-muted)' }}>{meta}</div>}
              {l.dates && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-faint)' }}>{l.dates}</div>}
              {live && (
                <div className="h-[3px] rounded-full mt-2 overflow-hidden" style={{ background: 'var(--c-border)' }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: 'var(--c-primary)' }} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};
