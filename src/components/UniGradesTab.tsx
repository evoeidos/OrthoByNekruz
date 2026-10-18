"use client";

import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { UniData } from '@/lib/uniHelpers';
import {
  numericGrade, gradeColors, gradeBucket, subjectBase, avg, fmtAvg, attendancePct,
} from '@/lib/uniHelpers';
import { UniLockedCard } from './UniLockedCard';

const BUCKETS = [5, 4, 3, 2] as const;

function plural(n: number, [one, few, many]: string[]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Доля шкалы 2–5, которую занимает балл (2 → 0, 5 → 1). */
const scaleShare = (n: number) => Math.max(0, Math.min(1, (n - 2) / 3));

// ─── Кольцо среднего балла (SVG) ──────────────────────────────────────────────
const AverageRing: React.FC<{ value: number | null; size?: number; stroke?: number }> =
({ value, size = 104, stroke = 10 }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - (value === null ? 0 : scaleShare(value)));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--c-border)" strokeWidth={stroke} fill="none" />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} stroke={gradeColors(value).solid} strokeWidth={stroke} fill="none"
            strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <div className="font-bold leading-none" style={{ fontSize: 30, letterSpacing: -1, color: 'var(--c-text)' }}>
          {fmtAvg(value)}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>из 5</div>
      </div>
    </div>
  );
};

export const UniGradesTab: React.FC<{ uni: UniData; onBind: () => void }> = ({ uni, onBind }) => {
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, typeof uni.grades>();
    uni.grades.forEach(g => {
      const k = subjectBase(g.subject);
      map.set(k, [...(map.get(k) ?? []), g]);
    });
    return [...map.entries()]
      .map(([name, rows]) => {
        const nums = rows.map(r => numericGrade(r.grade)).filter((n): n is number => n !== null);
        const absent = rows.filter(r => r.grade === 'Неявка').length;
        return { name, rows, nums, absent, average: avg(nums) };
      })
      // Сверху лучшие, предметы без оценок (только посещаемость) — в конце
      .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  }, [uni.grades]);

  if (!uni.bound) return <UniLockedCard title="Оценки не подключены" loading={uni.checking || uni.loading} onBind={onBind} />;
  if (uni.loading) return <UniLockedCard title="" loading onBind={onBind} />;
  if (uni.grades.length === 0) {
    return (
      <p className="text-[12.5px] text-center py-6" style={{ color: 'var(--c-muted)' }}>Оценок пока нет.</p>
    );
  }

  const allNums = uni.grades.map(g => numericGrade(g.grade)).filter((n): n is number => n !== null);
  const total = avg(allNums);
  const att = attendancePct(uni.grades);
  const status = uni.profile?.status;
  const dist = BUCKETS.map(b => ({ b, count: allNums.filter(n => gradeBucket(n) === b).length }));

  return (
    <>
      <div
        className="rounded-[20px] p-[18px] flex items-center gap-5"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
      >
        <AverageRing value={total} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
            Средний балл
          </div>
          {allNums.length > 0 && (
            <>
              <div className="flex gap-[3px] h-2 mt-2.5">
                {dist.filter(d => d.count).map(d => (
                  <span key={d.b} className="rounded-full" style={{ flex: `${d.count} 1 0`, background: gradeColors(d.b).solid }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-1 mt-2 text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                {dist.filter(d => d.count).map(d => (
                  <span key={d.b} className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: gradeColors(d.b).solid }} />
                    <b style={{ color: 'var(--c-text)' }}>{d.b}</b>×{d.count}
                  </span>
                ))}
              </div>
            </>
          )}
          <div className="text-[12px] leading-relaxed mt-2" style={{ color: 'var(--c-muted)' }}>
            {att !== null && <div>Посещаемость {att}%</div>}
            <div>{allNums.length} {plural(allNums.length, ['оценка', 'оценки', 'оценок'])}</div>
            {status && <div style={{ color: 'var(--c-danger)', fontWeight: 600 }}>{status}</div>}
          </div>
        </div>
      </div>

      <div
        className="rounded-[16px] overflow-hidden"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
      >
        {groups.map((g, gi) => {
          const isOpen = open === g.name;
          const c = g.average !== null ? gradeColors(g.average) : null;
          return (
            <div key={g.name} style={{ borderTop: gi ? '1px solid var(--c-border)' : undefined }}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.name)}
                className="w-full text-left px-4 py-3"
                aria-expanded={isOpen}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>{g.name}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[15px] font-bold" style={{ color: c ? c.fg : 'var(--c-muted)' }}>
                      {fmtAvg(g.average)}
                    </span>
                    <ChevronDown
                      className="w-4 h-4 self-center transition-transform"
                      style={{ color: 'var(--c-text-faint)', transform: isOpen ? 'rotate(180deg)' : undefined }}
                    />
                  </span>
                </div>
                {g.average !== null && c && (
                  <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--c-border)' }}>
                    <div
                      className="h-full rounded-full"
                      // Минимум 4%, чтобы двойка не превращалась в пустую шкалу
                      style={{ width: `${Math.max(4, scaleShare(g.average) * 100)}%`, background: c.solid, transition: 'width 0.6s ease' }}
                    />
                  </div>
                )}
                <div className="mt-1.5 text-[11px]" style={{ color: 'var(--c-text-faint)' }}>
                  {g.nums.length
                    ? `${g.nums.length} ${plural(g.nums.length, ['оценка', 'оценки', 'оценок'])}`
                    : 'Только отметки посещаемости'}
                  {g.absent > 0 && (
                    <span style={{ color: 'var(--c-danger)' }}>
                      {' · '}{g.absent} {plural(g.absent, ['неявка', 'неявки', 'неявок'])}
                    </span>
                  )}
                </div>
              </button>
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-subtle)' }}>
                  {g.rows.map((r, i) => {
                    const n = numericGrade(r.grade);
                    return (
                      <div
                        key={i}
                        className="flex items-start justify-between gap-2 px-4 py-2 text-[12px]"
                        style={{ borderTop: i ? '1px solid var(--c-border)' : undefined }}
                      >
                        <div className="min-w-0">
                          <div style={{ color: 'var(--c-text)' }}>{r.subject.includes(' — ') ? r.subject.split(' — ').slice(1).join(' — ') : r.kind}</div>
                          <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--c-text-faint)' }}>
                            {[r.date, r.kind, r.teacher].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        {n !== null ? (
                          <span
                            className="min-w-7 h-7 px-1 rounded-lg flex items-center justify-center text-[13px] font-bold flex-shrink-0"
                            style={{ background: gradeColors(n).bg, color: gradeColors(n).fg }}
                          >
                            {r.grade}
                          </span>
                        ) : (
                          <span
                            className="font-bold flex-shrink-0"
                            style={{ color: r.grade === 'Неявка' ? 'var(--c-danger)' : 'var(--c-muted)' }}
                          >
                            {r.grade}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};
