"use client";

import React, { useMemo, useState } from 'react';
import type { UniData } from '@/lib/uniHelpers';
import {
  numericGrade, gradeColors, subjectBase, avg, fmtAvg, attendancePct,
} from '@/lib/uniHelpers';
import { UniLockedCard } from './UniLockedCard';

export const UniGradesTab: React.FC<{ uni: UniData; onBind: () => void }> = ({ uni, onBind }) => {
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, typeof uni.grades>();
    uni.grades.forEach(g => {
      const k = subjectBase(g.subject);
      map.set(k, [...(map.get(k) ?? []), g]);
    });
    return [...map.entries()].map(([name, rows]) => {
      const nums = rows.map(r => numericGrade(r.grade)).filter((n): n is number => n !== null);
      return { name, rows, nums, average: avg(nums) };
    });
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

  return (
    <>
      <div
        className="rounded-[20px] p-[18px] flex items-center gap-5"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
      >
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Средний балл</div>
          <div className="font-bold leading-none mt-1" style={{ fontSize: 42, letterSpacing: -2, color: 'var(--c-text)' }}>
            {fmtAvg(total)}
          </div>
        </div>
        <div className="flex-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--c-muted)' }}>
          {att !== null && <div>Посещаемость {att}%</div>}
          <div>Оценок: {allNums.length}</div>
          {status && <div style={{ color: 'var(--c-danger)', fontWeight: 600 }}>{status}</div>}
        </div>
      </div>

      {groups.map(g => {
        const isOpen = open === g.name;
        return (
          <div
            key={g.name}
            className="rounded-[16px] overflow-hidden"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : g.name)}
              className="w-full text-left px-4 py-3.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>{g.name}</span>
                <span
                  className="text-[15px] font-bold flex-shrink-0"
                  style={{ color: g.average !== null ? gradeColors(g.average).fg : 'var(--c-muted)' }}
                >
                  {fmtAvg(g.average)}
                </span>
              </div>
              <div className="flex gap-1.5 mt-2.5 flex-wrap">
                {g.nums.slice(-6).map((n, i) => {
                  const c = gradeColors(n);
                  return (
                    <span
                      key={i}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold"
                      style={{ background: c.bg, color: c.fg }}
                    >
                      {String(n).replace('.', ',')}
                    </span>
                  );
                })}
                {g.nums.length === 0 && (
                  <span className="text-[12px]" style={{ color: 'var(--c-text-faint)' }}>Только отметки посещаемости</span>
                )}
              </div>
            </button>
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--c-border)' }}>
                {g.rows.map((r, i) => (
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
                    <span
                      className="font-bold font-mono flex-shrink-0"
                      style={{
                        color: r.grade === 'Неявка' ? 'var(--c-danger)' : r.grade === 'Явка' ? 'var(--c-muted)' : 'var(--c-primary)',
                      }}
                    >
                      {r.grade}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
