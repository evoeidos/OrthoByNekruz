"use client";

import React, { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, FileText, Loader2 } from 'lucide-react';
import type { UniData } from '@/lib/uniHelpers';
import { getTelegramAuth } from '@/lib/uniHelpers';
import type { UniversityLibrarySubject, UniversityMethodichka } from '@/lib/universityParser';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UniLockedCard } from './UniLockedCard';

type LibraryState = 'idle' | 'loading' | { error: string } | UniversityLibrarySubject[];
type MethodichkaState = 'loading' | UniversityMethodichka | { error: string };

export const UniLibraryTab: React.FC<{ uni: UniData; onBind: () => void }> = ({ uni, onBind }) => {
  const [subjects, setSubjects] = useState<LibraryState>('idle');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [openTlId, setOpenTlId] = useState<string | null>(null);
  const [methodichkas, setMethodichkas] = useState<Record<string, MethodichkaState>>({});

  useEffect(() => {
    if (!uni.bound || uni.checking || subjects !== 'idle') return;
    setSubjects('loading');
    (async () => {
      try {
        const { telegram_id, initData } = getTelegramAuth();
        const r = await fetch('/api/auth/university/data', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegram_id, initData, action: 'library' }),
        });
        const d = await r.json();
        if (!r.ok) {
          setSubjects({ error: `${d.error || 'Ошибка сервера'} (HTTP ${r.status})` });
        } else {
          setSubjects(d.subjects ?? []);
        }
      } catch (e) {
        setSubjects({ error: e instanceof Error ? e.message : 'Сетевая ошибка' });
      }
    })();
  }, [uni.bound, uni.checking, subjects]);

  const openMethodichka = (tlId: string) => {
    setOpenTlId(tlId);
    if (methodichkas[tlId] !== undefined) return;
    setMethodichkas(m => ({ ...m, [tlId]: 'loading' }));
    (async () => {
      try {
        const { telegram_id, initData } = getTelegramAuth();
        const r = await fetch('/api/auth/university/data', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegram_id, initData, action: 'methodichka', tlId }),
        });
        const d = await r.json();
        if (!r.ok) {
          setMethodichkas(m => ({ ...m, [tlId]: { error: `${d.error || 'Ошибка сервера'} (HTTP ${r.status}${d.code ? `, ${d.code}` : ''})` } }));
        } else if (!d.methodichka) {
          setMethodichkas(m => ({ ...m, [tlId]: { error: 'У этой темы нет методических указаний для обучающихся на сайте (либо не удалось распознать страницу).' } }));
        } else {
          setMethodichkas(m => ({ ...m, [tlId]: d.methodichka }));
        }
      } catch (e) {
        setMethodichkas(m => ({ ...m, [tlId]: { error: e instanceof Error ? e.message : 'Сетевая ошибка' } }));
      }
    })();
  };

  if (!uni.bound) return <UniLockedCard title="Библиотека методичек не подключена" loading={uni.checking} onBind={onBind} />;

  if (subjects === 'idle' || subjects === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px]" style={{ color: 'var(--c-muted)' }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Собираем каталог дисциплин...
      </div>
    );
  }

  if ('error' in subjects) {
    return (
      <p className="text-[12.5px] text-center py-6 px-4" style={{ color: 'var(--c-muted)' }}>
        {subjects.error}
      </p>
    );
  }

  if (subjects.length === 0) {
    return (
      <p className="text-[12.5px] text-center py-6" style={{ color: 'var(--c-muted)' }}>
        Не нашли ни одной дисциплины с тематическим планом на сайте.
      </p>
    );
  }

  return (
    <>
      <div className="text-[10px] font-bold uppercase tracking-widest px-1 pt-1" style={{ color: 'var(--c-muted)' }}>
        {subjects.length} {subjects.length === 1 ? 'дисциплина' : subjects.length < 5 ? 'дисциплины' : 'дисциплин'}
      </div>

      <div className="space-y-2">
        {subjects.map(subj => {
          const isOpen = expanded === subj.discipline;
          const total = subj.lectures.length + subj.practice.length;
          return (
            <div
              key={subj.discipline}
              className="rounded-[16px] overflow-hidden"
              style={{ border: '1px solid var(--c-border)' }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : subj.discipline)}
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
                    {subj.discipline}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                    {total} {total === 1 ? 'тема' : total < 5 ? 'темы' : 'тем'}
                  </div>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isOpen && (
                <div className="divide-y" style={{ borderTop: '1px solid var(--c-border)', borderColor: 'var(--c-border)' }}>
                  {subj.lectures.length > 0 && (
                    <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                      Лекции
                    </div>
                  )}
                  {subj.lectures.map(row => (
                    <button
                      key={`l-${row.tlId}`}
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
                  ))}

                  {subj.practice.length > 0 && (
                    <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                      Практика
                    </div>
                  )}
                  {subj.practice.map(row => (
                    <button
                      key={`p-${row.tlId}`}
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
                  ))}
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
