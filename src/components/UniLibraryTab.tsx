"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, FileText, Loader2 } from 'lucide-react';
import type { UniData } from '@/lib/uniHelpers';
import { findActiveCycle, getTelegramAuth, krasnoyarskNow } from '@/lib/uniHelpers';
import type { UniversityLibraryDiscipline, UniversityMethodichka, UniversityTopicPlan } from '@/lib/universityParser';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UniLockedCard } from './UniLockedCard';

type DisciplinesState = 'idle' | 'loading' | { error: string } | UniversityLibraryDiscipline[];
type TopicPlanState = 'loading' | UniversityTopicPlan | { error: string };
type MethodichkaState = 'loading' | UniversityMethodichka | { error: string };

async function postUniData(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const { telegram_id, initData } = getTelegramAuth();
  const r = await fetch('/api/auth/university/data', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_id, initData, ...body }),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

export const UniLibraryTab: React.FC<{ uni: UniData; onBind: () => void }> = ({ uni, onBind }) => {
  const [disciplines, setDisciplines] = useState<DisciplinesState>('idle');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [topicPlans, setTopicPlans] = useState<Record<string, TopicPlanState>>({});

  const [openTlId, setOpenTlId] = useState<string | null>(null);
  const [methodichkas, setMethodichkas] = useState<Record<string, MethodichkaState>>({});

  const activeNames = useMemo(() => {
    const names = new Set<string>();
    for (const day of uni.schedule) {
      for (const lesson of day.lessons) {
        if (lesson.subject !== 'ПРАКТИКА') names.add(lesson.subject.trim());
      }
    }
    const cycle = findActiveCycle(uni.cycles, krasnoyarskNow().date);
    if (cycle) names.add(cycle.discipline);
    return names;
  }, [uni.schedule, uni.cycles]);

  const sortedDisciplines = useMemo(() => {
    if (!Array.isArray(disciplines)) return [];
    const isActive = (d: UniversityLibraryDiscipline) => activeNames.has(d.discipline);
    return [...disciplines.filter(isActive), ...disciplines.filter(d => !isActive(d))];
  }, [disciplines, activeNames]);

  useEffect(() => {
    if (!uni.bound || uni.checking || disciplines !== 'idle') return;
    setDisciplines('loading');
    (async () => {
      try {
        const { ok, status, data } = await postUniData({ action: 'library' });
        if (!ok) {
          setDisciplines({ error: `${data.error || 'Ошибка сервера'} (HTTP ${status})` });
        } else {
          setDisciplines((data.disciplines as UniversityLibraryDiscipline[]) ?? []);
        }
      } catch (e) {
        setDisciplines({ error: e instanceof Error ? e.message : 'Сетевая ошибка' });
      }
    })();
  }, [uni.bound, uni.checking, disciplines]);

  const toggleDiscipline = (d: UniversityLibraryDiscipline) => {
    const next = expanded === d.umkdId ? null : d.umkdId;
    setExpanded(next);
    if (!next || topicPlans[d.umkdId] !== undefined) return;
    setTopicPlans(p => ({ ...p, [d.umkdId]: 'loading' }));
    (async () => {
      try {
        const { ok, status, data } = await postUniData({ action: 'library_topics', umkdId: d.umkdId });
        if (!ok) {
          setTopicPlans(p => ({ ...p, [d.umkdId]: { error: `${data.error || 'Ошибка сервера'} (HTTP ${status})` } }));
        } else {
          setTopicPlans(p => ({
            ...p,
            [d.umkdId]: {
              lectures: (data.lectures as UniversityTopicPlan['lectures']) ?? [],
              practice: (data.practice as UniversityTopicPlan['practice']) ?? [],
            },
          }));
        }
      } catch (e) {
        setTopicPlans(p => ({ ...p, [d.umkdId]: { error: e instanceof Error ? e.message : 'Сетевая ошибка' } }));
      }
    })();
  };

  const openMethodichka = (tlId: string) => {
    setOpenTlId(tlId);
    if (methodichkas[tlId] !== undefined) return;
    setMethodichkas(m => ({ ...m, [tlId]: 'loading' }));
    (async () => {
      try {
        const { ok, status, data } = await postUniData({ action: 'methodichka', tlId });
        if (!ok) {
          setMethodichkas(m => ({ ...m, [tlId]: { error: `${data.error || 'Ошибка сервера'} (HTTP ${status}${data.code ? `, ${data.code}` : ''})` } }));
        } else if (!data.methodichka) {
          setMethodichkas(m => ({ ...m, [tlId]: { error: 'У этой темы нет методических указаний для обучающихся на сайте (либо не удалось распознать страницу).' } }));
        } else {
          setMethodichkas(m => ({ ...m, [tlId]: data.methodichka as UniversityMethodichka }));
        }
      } catch (e) {
        setMethodichkas(m => ({ ...m, [tlId]: { error: e instanceof Error ? e.message : 'Сетевая ошибка' } }));
      }
    })();
  };

  if (!uni.bound) return <UniLockedCard title="Библиотека методичек не подключена" loading={uni.checking} onBind={onBind} />;

  if (disciplines === 'idle' || disciplines === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px]" style={{ color: 'var(--c-muted)' }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Загружаем дисциплины...
      </div>
    );
  }

  if ('error' in disciplines) {
    return (
      <p className="text-[12.5px] text-center py-6 px-4" style={{ color: 'var(--c-muted)' }}>
        {disciplines.error}
      </p>
    );
  }

  if (disciplines.length === 0) {
    return (
      <p className="text-[12.5px] text-center py-6" style={{ color: 'var(--c-muted)' }}>
        Не нашли ни одной дисциплины на сайте.
      </p>
    );
  }

  const renderTopicRows = (rows: UniversityTopicPlan['lectures'], kind: 'l' | 'p') => rows.map(row => (
    <button
      key={`${kind}-${row.tlId}`}
      type="button"
      onClick={() => openMethodichka(row.tlId)}
      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left active:scale-[0.99] transition-transform"
    >
      <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--c-primary)' }} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] leading-snug" style={{ color: 'var(--c-text)' }}>
          <span className="font-bold" style={{ color: 'var(--c-primary)' }}>№{row.seq}</span> {row.topic}
        </div>
        {row.section && (
          <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-faint)' }}>{row.section}</div>
        )}
      </div>
    </button>
  ));

  return (
    <>
      <div className="text-[10px] font-bold uppercase tracking-widest px-1 pt-1" style={{ color: 'var(--c-muted)' }}>
        {disciplines.length} {disciplines.length === 1 ? 'дисциплина' : disciplines.length < 5 ? 'дисциплины' : 'дисциплин'}
      </div>

      <div className="space-y-2">
        {sortedDisciplines.map(d => {
          const isOpen = expanded === d.umkdId;
          const plan = topicPlans[d.umkdId];
          const isActive = activeNames.has(d.discipline);
          return (
            <div
              key={d.umkdId}
              className="rounded-[16px] overflow-hidden"
              style={{ border: '1px solid var(--c-border)' }}
            >
              <button
                type="button"
                onClick={() => toggleDiscipline(d)}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left"
                style={{ background: 'var(--c-card)' }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
                >
                  <BookOpen className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-bold leading-snug" style={{ color: 'var(--c-text)' }}>
                    {d.discipline}
                  </div>
                  {isActive && (
                    <span
                      className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1"
                      style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary-strong)' }}
                    >
                      В расписании
                    </span>
                  )}
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--c-border)' }}>
                  {(plan === undefined || plan === 'loading') && (
                    <div className="flex items-center justify-center gap-2 py-6 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" /> Загружаем темы...
                    </div>
                  )}
                  {plan !== undefined && plan !== 'loading' && 'error' in plan && (
                    <p className="text-[12px] text-center py-4 px-4" style={{ color: 'var(--c-muted)' }}>{plan.error}</p>
                  )}
                  {plan !== undefined && plan !== 'loading' && !('error' in plan) && (
                    <div className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
                      {plan.lectures.length === 0 && plan.practice.length === 0 && (
                        <p className="text-[12px] text-center py-4" style={{ color: 'var(--c-muted)' }}>Тем не найдено.</p>
                      )}
                      {plan.lectures.length > 0 && (
                        <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Лекции</div>
                      )}
                      {renderTopicRows(plan.lectures, 'l')}
                      {plan.practice.length > 0 && (
                        <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Практика</div>
                      )}
                      {renderTopicRows(plan.practice, 'p')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!openTlId} onOpenChange={o => { if (!o) setOpenTlId(null); }}>
        <DialogContent
          className="max-w-lg w-[92vw] max-h-[85vh] overflow-y-auto rounded-3xl p-5"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
        >
          {(() => {
            const data = openTlId ? methodichkas[openTlId] : undefined;
            if (data === 'loading' || data === undefined) {
              return (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px]" style={{ color: 'var(--c-muted)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> Загрузка методички...
                </div>
              );
            }
            if ('error' in data) {
              return (
                <p className="text-[13px] text-center py-10 px-4" style={{ color: 'var(--c-muted)' }}>
                  {data.error}
                </p>
              );
            }
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-[15px] font-bold leading-snug pr-4" style={{ color: 'var(--c-text)' }}>
                    {data.title}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-1">
                  {data.chapters.map((ch, ci) => (
                    <div key={ci}>
                      {ch.title && (
                        <div className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-primary)' }}>
                          {ch.title}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {ch.paragraphs.map((p, pi) => (
                          <p key={pi} className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--c-text)' }}>
                            {p}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
};
