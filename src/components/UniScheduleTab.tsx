"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Loader2, Video } from 'lucide-react';
import type { UniData } from '@/lib/uniHelpers';
import {
  krasnoyarskNow, currentWeekDays, parseTimeRange, datesIncludeToday, findMatchingDateEntry, findActiveCycle,
  MONTHS_GEN,
} from '@/lib/uniHelpers';
import { loadMethodichka } from '@/lib/uniCache';
import { MethodichkaDialog, type MethodichkaState } from './MethodichkaDialog';
import { UniLockedCard } from './UniLockedCard';

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

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
  const [weekOffset, setWeekOffset] = useState(0);
  const week = useMemo(() => currentWeekDays(weekOffset), [now.weekdayIdx, weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => { setExpanded({}); }, [picked]);

  const [openTlId, setOpenTlId] = useState<string | null>(null);
  const [openContext, setOpenContext] = useState<{ discipline: string; topic: string } | null>(null);
  const [methodichkas, setMethodichkas] = useState<Record<string, MethodichkaState>>({});

  const openMethodichka = (tlId: string, discipline: string, topic: string) => {
    setOpenTlId(tlId);
    setOpenContext({ discipline, topic });
    if (methodichkas[tlId] !== undefined) return;
    setMethodichkas(m => ({ ...m, [tlId]: 'loading' }));
    void loadMethodichka(tlId, state => setMethodichkas(m => ({ ...m, [tlId]: state })));
  };

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
  const selDate = week.find(w => w.weekday === selected);
  const isToday = !!selDate && sameDay(selDate.date, now.date);
  const day = uni.schedule.find(d => d.weekday === selected);
  // Расписание хранится шаблоном по дням недели с перечнем конкретных дат —
  // показываем только те пары, которые реально идут в выбранную дату.
  const lessons = (day?.lessons ?? []).filter(l =>
    !selDate || datesIncludeToday(l.dates, { day: selDate.num, month: selDate.month }),
  );

  const today = { day: now.date.getUTCDate(), month: now.date.getUTCMonth() };
  // «ПРАКТИКА» в недельной сетке — заглушка: реальная дисциплина зависит от того,
  // в диапазон дат какого цикла (циклового расписания) попадает просматриваемый день.
  const activeCycle = selDate ? findActiveCycle(uni.cycles, selDate.date) : null;
  // Темы практики (uni.practiceTopics) проиндексированы датой С ГОДОМ — в отличие
  // от тем лекций, где год не нужен (даты в пределах одного семестра не пересекаются).
  const practiceDateKey = selDate ? `${selDate.num} ${MONTHS_GEN[selDate.month]} ${selDate.date.getUTCFullYear()}` : null;

  const withState = lessons.map(l => {
    const isCyclePlaceholder = l.subject === 'ПРАКТИКА';
    const subject = isCyclePlaceholder && activeCycle ? activeCycle.discipline : l.subject;
    const room = isCyclePlaceholder && activeCycle ? activeCycle.address : l.room;
    const dateEntry = selDate ? findMatchingDateEntry(l.dates, { day: selDate.num, month: selDate.month }) : null;
    const topic = isCyclePlaceholder
      ? (activeCycle && practiceDateKey ? uni.practiceTopics[activeCycle.discipline]?.[practiceDateKey] : undefined)
      : (dateEntry ? uni.topics[subject]?.[dateEntry] : undefined);
    return {
      l,
      subject,
      room,
      cycle: isCyclePlaceholder ? activeCycle : null,
      range: parseTimeRange(l.time),
      dateMatch: datesIncludeToday(l.dates, today),
      topic,
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
      <div className="flex items-center justify-between px-1">
        <button type="button" onClick={() => setWeekOffset(o => o - 1)} aria-label="Предыдущая неделя"
          className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95" style={{ color: 'var(--c-primary)' }}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--c-text)' }}>
          {week[0].num} {MONTHS_GEN[week[0].month]} – {week[week.length - 1].num} {MONTHS_GEN[week[week.length - 1].month]}
          {weekOffset !== 0 && (
            <button type="button" onClick={() => setWeekOffset(0)} className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary-strong)' }}>
              Сегодня
            </button>
          )}
        </div>
        <button type="button" onClick={() => setWeekOffset(o => o + 1)} aria-label="Следующая неделя"
          className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95" style={{ color: 'var(--c-primary)' }}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-6 gap-1">
        {week.map(w => {
          const active = w.weekday === selected;
          const today = sameDay(w.date, now.date);
          const has = (uni.schedule.find(d => d.weekday === w.weekday)?.lessons ?? [])
            .filter(l => datesIncludeToday(l.dates, { day: w.num, month: w.month })).length;
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

      {(() => {
        const decorated = withState.map((x, i) => {
          const { range, dateMatch } = x;
          const live = isToday && dateMatch && !!range && now.minutes >= range[0] && now.minutes < range[1];
          const past = isToday && dateMatch && !!range && now.minutes >= range[1];
          const next = !live && i === nextIdx;
          const badge = live && range
            ? `Идёт сейчас · ещё ${range[1] - now.minutes} мин`
            : next && range ? `Далее · через ${range[0] - now.minutes} мин` : '';
          const pct = live && range ? Math.round(((now.minutes - range[0]) / (range[1] - range[0])) * 100) : 0;
          const meta = [x.l.type, x.room, x.l.teacher].filter(Boolean).join(' · ');
          return { ...x, live, past, badge, pct, meta };
        });

        // Несколько лекций делят один и тот же временной слот (ротация по чётным/нечётным
        // датам) — визуально это выглядит как куча пар подряд, хотя реально идёт только
        // одна. Схлопываем такую группу в одну карточку с актуальной парой сверху и
        // разворачиваемым списком остальных вариантов снизу — но только когда среди
        // группы ровно одна дата совпадает с просматриваемым днём (типичный случай);
        // иначе (0 или 2+ совпадений) показываем всё как раньше, чтобы не потерять данные.
        const groups: (typeof decorated)[number][][] = [];
        const groupIdxByTime = new Map<string, number>();
        for (const item of decorated) {
          let gi = groupIdxByTime.get(item.l.time);
          if (gi === undefined) {
            gi = groups.length;
            groupIdxByTime.set(item.l.time, gi);
            groups.push([]);
          }
          groups[gi].push(item);
        }

        const renderCardBody = (item: (typeof decorated)[number]) => (
          <div className="flex-1 min-w-0 flex flex-col">
            {item.badge && (
              <span
                className="self-start text-[10.5px] font-bold px-2 py-0.5 rounded-full mb-1.5"
                style={{
                  background: item.live ? 'var(--c-primary)' : 'var(--c-bg-subtle)',
                  color: item.live ? 'var(--c-bg)' : 'var(--c-muted)',
                }}
              >
                {item.badge}
              </span>
            )}
            <div className="text-[14px] font-bold leading-snug" style={{ color: 'var(--c-text)' }}>{item.subject}</div>
            {item.topic && (
              <div className="text-[12.5px] mt-1 leading-snug" style={{ color: 'var(--c-text)' }}>
                <span className="font-bold" style={{ color: 'var(--c-primary)' }}>№{item.topic.seq}</span> {item.topic.topic}
              </div>
            )}
            {item.topic && (
              <button
                type="button"
                onClick={() => openMethodichka(item.topic!.tlId, item.subject, item.topic!.topic)}
                className="self-start inline-flex items-center gap-1 text-[11px] font-semibold mt-1.5"
                style={{ color: 'var(--c-primary)' }}
              >
                <FileText className="w-3 h-3" /> Методичка
              </button>
            )}
            {item.l.link && (
              <a
                href={item.l.link}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start inline-flex items-center gap-1 text-[11px] font-semibold mt-1.5"
                style={{ color: 'var(--c-primary)' }}
              >
                <Video className="w-3 h-3" /> Подключиться к занятию
              </a>
            )}
            {item.meta && <div className="text-[12px] mt-0.5" style={{ color: 'var(--c-muted)' }}>{item.meta}</div>}
            {item.l.dates && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-faint)' }}>{item.l.dates}</div>}
            {item.cycle && (
              <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-faint)' }}>
                Цикл: {item.cycle.startDate} – {item.cycle.endDate}
              </div>
            )}
            {item.live && (
              <div className="h-[3px] rounded-full mt-2 overflow-hidden" style={{ background: 'var(--c-border)' }}>
                <div className="h-full" style={{ width: `${item.pct}%`, background: 'var(--c-primary)' }} />
              </div>
            )}
          </div>
        );

        return groups.map((group, gi) => {
          const matched = group.filter(x => x.dateMatch);
          const primary = group.length > 1 && matched.length === 1 ? matched[0] : null;
          const alternates = primary ? group.filter(x => x !== primary) : [];
          const isOpen = !!expanded[group[0].l.time];

          if (!primary) {
            // Обычный случай (одна пара в слоте) либо неоднозначная группа — без сворачивания.
            return group.map((item, ii) => (
              <div
                key={`${gi}-${ii}`}
                className="flex gap-3 rounded-[16px] px-3.5 py-3"
                style={{
                  background: item.live ? 'var(--c-primary-soft)' : 'var(--c-card)',
                  border: item.live ? '1.5px solid var(--c-primary)' : '1px solid var(--c-border)',
                  opacity: item.past ? 0.5 : 1,
                }}
              >
                <div className="w-[52px] flex-shrink-0 font-mono text-[12px] font-bold leading-snug" style={{ color: 'var(--c-muted)' }}>
                  {(item.l.time || '').split(/\s*[\/–-]\s*/).map((t, ti) => <div key={ti}>{t}</div>)}
                </div>
                <div className="w-[3px] rounded-full flex-shrink-0" style={{ background: LESSON_COLORS[gi % 3] }} />
                {renderCardBody(item)}
              </div>
            ));
          }

          return (
            <div key={gi} className="rounded-[16px] overflow-hidden" style={{ border: primary.live ? '1.5px solid var(--c-primary)' : '1px solid var(--c-border)' }}>
              <div
                className="flex gap-3 px-3.5 py-3"
                style={{ background: primary.live ? 'var(--c-primary-soft)' : 'var(--c-card)', opacity: primary.past ? 0.5 : 1 }}
              >
                <div className="w-[52px] flex-shrink-0 font-mono text-[12px] font-bold leading-snug" style={{ color: 'var(--c-muted)' }}>
                  {(primary.l.time || '').split(/\s*[\/–-]\s*/).map((t, ti) => <div key={ti}>{t}</div>)}
                </div>
                <div className="w-[3px] rounded-full flex-shrink-0" style={{ background: LESSON_COLORS[gi % 3] }} />
                {renderCardBody(primary)}
              </div>

              <button
                type="button"
                onClick={() => setExpanded(e => ({ ...e, [group[0].l.time]: !e[group[0].l.time] }))}
                className="w-full flex items-center justify-between px-3.5 py-2 text-[11px] font-semibold"
                style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-muted)' }}
              >
                <span>Ещё {alternates.length} {alternates.length === 1 ? 'вариант' : 'варианта'} на этот слот</span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {isOpen && alternates.map((alt, ai) => (
                <div key={ai} className="px-3.5 py-2 text-[12px]" style={{ borderTop: '1px solid var(--c-border)', opacity: 0.65 }}>
                  <div className="font-semibold" style={{ color: 'var(--c-text)' }}>{alt.subject}</div>
                  {alt.meta && <div className="mt-0.5" style={{ color: 'var(--c-muted)' }}>{alt.meta}</div>}
                  {alt.l.dates && <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--c-text-faint)' }}>{alt.l.dates}</div>}
                </div>
              ))}
            </div>
          );
        });
      })()}

      <MethodichkaDialog tlId={openTlId} state={openTlId ? methodichkas[openTlId] : undefined} context={openContext} onClose={() => setOpenTlId(null)} />
    </>
  );
};
