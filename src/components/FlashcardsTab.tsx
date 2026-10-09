"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, RotateCcw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadSubjectData } from '@/lib/subjectData';
import {
  type BioQuestionFlash,
  type FlashcardItem,
  type TopicStats,
  topicLabel,
  expandAllFlashcards,
  buildSessionDeck,
  computeTopicStats,
  flashcardMember,
  GLOSSARY_TOPIC_ID,
} from '@/lib/flashcards';
import {
  fetchWeakFlashcards,
  markFlashcardKnown,
  markFlashcardWeak,
} from '@/lib/flashcardsApi';

interface FlashcardsTabProps {
  subject?: string;
  accentColor?: string;
  bustDataCache?: boolean;
}

type Phase = 'loading' | 'play' | 'summary';

function TopicPickerModal({
  onClose,
  topicFilter,
  topicStats,
  allTotal,
  allWeak,
  accentColor,
  onSelect,
}: {
  onClose: () => void;
  topicFilter: string | null;
  topicStats: TopicStats[];
  allTotal: number;
  allWeak: number;
  accentColor: string;
  onSelect: (topicId: string | null) => void;
}) {
  const rows: { id: string | null; label: string; total: number; weak: number }[] = [
    { id: null, label: 'Все темы', total: allTotal, weak: allWeak },
    ...topicStats.map(t => ({ id: t.topicId, label: t.label, total: t.total, weak: t.weak })),
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'hsl(0 0% 0% / 0.45)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.22 }}
        className="w-full max-w-md max-h-[min(78vh,560px)] flex flex-col rounded-[22px] overflow-hidden"
        style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--c-border)' }}
        >
          <h3 className="text-base font-bold" style={{ color: 'var(--c-text)' }}>Выбор темы</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform duration-150"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" style={{ color: 'var(--c-muted)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2">
          {rows.map(row => {
            const selected = topicFilter === row.id;
            const strong = row.total - row.weak;
            const pct = row.total > 0 ? Math.round((strong / row.total) * 100) : 0;
            return (
              <button
                key={row.id ?? '__all__'}
                type="button"
                onClick={() => { onSelect(row.id); onClose(); }}
                className="w-full text-left rounded-[16px] p-4 transition-all active:scale-[0.98]"
                style={{
                  background: selected
                    ? 'var(--c-primary-soft)'
                    : 'var(--c-card)',
                  border: selected
                    ? `1.5px solid var(--c-primary-br)`
                    : '1px solid var(--c-border)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold leading-snug" style={{ color: 'var(--c-text)' }}>
                      {row.label}
                    </div>
                    <div className="text-[12px] mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5" style={{ color: 'var(--c-muted)' }}>
                      <span>{row.total} {row.total === 1 ? 'карточка' : row.total < 5 ? 'карточки' : 'карточек'}</span>
                      <span>·</span>
                      <span style={{ color: row.weak > 0 ? 'var(--c-danger)' : 'var(--c-muted)' }}>
                        {row.weak} слабых
                      </span>
                      <span>·</span>
                      <span style={{ color: 'var(--c-primary)' }}>{pct}% знаю</span>
                    </div>
                  </div>
                  {selected && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0"
                      style={{ background: accentColor, color: 'var(--c-bg)' }}
                    >
                      Сейчас
                    </span>
                  )}
                </div>
                <div
                  className="mt-3 h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--c-border)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: accentColor }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

export const FlashcardsTab: React.FC<FlashcardsTabProps> = ({
  subject = 'bio',
  accentColor = 'var(--c-primary)',
  bustDataCache = false,
}) => {
  const [phase, setPhase]           = useState<Phase>('loading');
  const [allCards, setAllCards]     = useState<FlashcardItem[]>([]);
  const [weakSet, setWeakSet]       = useState<Set<string>>(new Set());
  const [topicFilter, setTopicFilter] = useState<string | null>(GLOSSARY_TOPIC_ID);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [queue, setQueue]           = useState<FlashcardItem[]>([]);
  const [flipped, setFlipped]       = useState(false);
  const [knownCount, setKnownCount] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const [sessionWeak, setSessionWeak] = useState<FlashcardItem[]>([]);

  const topicStats = useMemo(
    () => computeTopicStats(allCards, weakSet, subject),
    [allCards, weakSet, subject],
  );

  const allTotal = allCards.length;
  const allWeak = useMemo(
    () => allCards.filter(c => weakSet.has(flashcardMember(c.questionId, c.factIndex))).length,
    [allCards, weakSet],
  );

  const currentTopicLabel = topicFilter === null
    ? 'Все темы'
    : topicLabel(topicFilter, subject);

  const startSession = useCallback((
    cards: FlashcardItem[],
    weak: Set<string>,
    topic: string | null,
    weakOnly = false,
  ) => {
    let deck = buildSessionDeck(cards, weak, topic);
    if (weakOnly) {
      deck = deck.filter(c => weak.has(flashcardMember(c.questionId, c.factIndex)));
    }
    if (deck.length === 0) {
      setQueue([]);
      setPhase('summary');
      return;
    }
    setQueue(deck);
    setFlipped(false);
    setKnownCount(0);
    setUnknownCount(0);
    setSessionWeak([]);
    setPhase('play');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    (async () => {
      const [questions, glossary, weak] = await Promise.all([
        loadSubjectData(subject, 'questions', { bustCache: bustDataCache }),
        loadSubjectData(subject, 'glossary', { bustCache: bustDataCache }),
        fetchWeakFlashcards(subject),
      ]);
      if (cancelled) return;
      const cards = expandAllFlashcards(
        questions as BioQuestionFlash[],
        glossary as { term?: string; definition?: string }[],
      );
      setAllCards(cards);
      setWeakSet(weak);
      setTopicFilter(GLOSSARY_TOPIC_ID);
      startSession(cards, weak, GLOSSARY_TOPIC_ID);
    })();
    return () => { cancelled = true; };
  }, [subject, bustDataCache, startSession]);

  const current = queue[0] ?? null;
  const remaining = queue.length;
  const totalInSession = knownCount + unknownCount + remaining;

  const applyTopicFilter = (topic: string | null) => {
    setTopicFilter(topic);
    startSession(allCards, weakSet, topic);
  };

  const handleFlip = () => {
    if (!current) return;
    setFlipped(f => !f);
  };

  const handleKnown = () => {
    if (!current) return;
    void markFlashcardKnown(subject, current.questionId, current.factIndex);
    setWeakSet(prev => {
      const next = new Set(prev);
      next.delete(flashcardMember(current.questionId, current.factIndex));
      return next;
    });
    setKnownCount(n => n + 1);
    setFlipped(false);
    setQueue(q => q.slice(1));
    if (queue.length <= 1) setPhase('summary');
  };

  const handleUnknown = () => {
    if (!current) return;
    void markFlashcardWeak(subject, current.questionId, current.factIndex);
    const key = flashcardMember(current.questionId, current.factIndex);
    setWeakSet(prev => new Set(prev).add(key));
    setUnknownCount(n => n + 1);
    setSessionWeak(prev => [...prev, current]);
    setFlipped(false);
    setQueue(q => [...q.slice(1), current]);
    if (queue.length <= 1) setPhase('summary');
  };

  useEffect(() => {
    if (phase === 'play' && queue.length === 0 && allCards.length > 0) {
      setPhase('summary');
    }
  }, [phase, queue.length, allCards.length]);

  const repeatWeak = () => {
    const weakKeys = new Set(sessionWeak.map(c => flashcardMember(c.questionId, c.factIndex)));
    if (weakKeys.size === 0) {
      startSession(allCards, weakSet, topicFilter, true);
      return;
    }
    const deck = sessionWeak.length > 0
      ? [...sessionWeak]
      : buildSessionDeck(allCards, weakSet, topicFilter).filter(
          c => weakKeys.has(flashcardMember(c.questionId, c.factIndex)),
        );
    if (deck.length === 0) {
      startSession(allCards, weakSet, topicFilter, true);
      return;
    }
    setQueue(deck);
    setFlipped(false);
    setKnownCount(0);
    setUnknownCount(0);
    setSessionWeak([]);
    setPhase('play');
  };

  const restartAll = () => {
    startSession(allCards, weakSet, topicFilter);
  };

  const topicPickerButton = (
    <button
      type="button"
      onClick={() => setTopicModalOpen(true)}
      className="flex items-center justify-center gap-1.5 mx-auto max-w-full px-4 py-2 rounded-full transition-all active:scale-[0.97]"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-border)',
      }}
    >
      <span
        className="text-[13px] font-bold truncate"
        style={{ color: accentColor }}
      >
        {currentTopicLabel}
      </span>
      <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-muted)' }} />
    </button>
  );

  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-24" style={{ color: accentColor }}>
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm mt-3" style={{ color: 'var(--c-muted)' }}>Загружаем карточки…</p>
      </div>
    );
  }

  if (allCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
        <p className="text-base font-semibold" style={{ color: 'var(--c-text)' }}>Нет карточек</p>
        <p className="text-sm mt-2" style={{ color: 'var(--c-muted)' }}>
          В данных нет key_facts для флэшкарт.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-shrink-0 px-4 pb-3 pt-1">
        {topicPickerButton}
      </div>

      {phase === 'summary' ? (
        <div className="flex flex-col items-center justify-center flex-1 px-6 py-8 text-center gap-6">
          <div className="text-5xl">🎉</div>
          <div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--c-text)' }}>
              Сессия завершена
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--c-muted)' }}>
              {currentTopicLabel}
            </p>
            <p className="text-sm leading-relaxed mt-2" style={{ color: 'var(--c-muted)' }}>
              Знал: <strong style={{ color: 'var(--c-primary)' }}>{knownCount}</strong>
              {' · '}
              Не знал: <strong style={{ color: 'var(--c-danger)' }}>{unknownCount}</strong>
              {totalInSession > 0 && (
                <>
                  {' · '}
                  Всего: {totalInSession}
                </>
              )}
            </p>
          </div>
          <div className="w-full max-w-xs flex flex-col gap-3">
            {(sessionWeak.length > 0 || unknownCount > 0) && (
              <button
                type="button"
                onClick={repeatWeak}
                className="w-full h-[52px] rounded-2xl text-[15px] font-bold active:scale-[0.98] transition-transform"
                style={{ background: accentColor, color: 'var(--c-bg)' }}
              >
                Повторить слабые
              </button>
            )}
            <button
              type="button"
              onClick={restartAll}
              className="w-full h-12 rounded-2xl text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98]"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-border)',
                color: 'var(--c-text)',
              }}
            >
              <RotateCcw className="w-4 h-4" />
              Начать заново
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-shrink-0 px-4 pb-2 text-center">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              Осталось {remaining} · Знаю {knownCount} · Не знаю {unknownCount}
            </p>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4 min-h-0">
            {current ? (
              <>
                <button
                  type="button"
                  onClick={handleFlip}
                  className="flashcard-scene w-full max-w-sm flex-1 max-h-[min(52vh,420px)] min-h-[240px] mb-4 active:scale-[0.98] transition-transform duration-150"
                  aria-label={flipped ? 'Нажми, чтобы вернуть вопрос' : 'Нажми, чтобы перевернуть'}
                >
                  <div className={`flashcard-inner w-full h-full ${flipped ? 'flashcard-flipped' : ''}`}>
                    <div
                      className="flashcard-face flashcard-front rounded-[20px] flex flex-col items-center justify-center p-6 text-center"
                      style={{
                        background: 'var(--c-card)',
                        boxShadow: '0 12px 40px hsl(0 0% 0% / 0.12), 0 2px 8px hsl(0 0% 0% / 0.06)',
                        border: '1px solid var(--c-border)',
                      }}
                    >
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest mb-3"
                        style={{ color: accentColor }}
                      >
                        {current.source === 'glossary' ? 'Глоссарий' : topicLabel(current.topic, subject)}
                      </span>
                      <p
                        className="text-lg font-bold leading-snug"
                        style={{ color: 'var(--c-text)' }}
                      >
                        {current.subtopic}
                      </p>
                      <p className="text-xs mt-6" style={{ color: 'var(--c-muted)' }}>
                        Нажми, чтобы перевернуть
                      </p>
                    </div>
                    <div
                      className="flashcard-face flashcard-back rounded-[20px] flex flex-col items-center justify-center p-6 text-center"
                      style={{
                        background: 'var(--c-card)',
                        boxShadow: '0 12px 40px hsl(0 0% 0% / 0.12), 0 2px 8px hsl(0 0% 0% / 0.06)',
                        border: '1px solid var(--c-primary-br)',
                      }}
                    >
                      <p
                        className="text-[15px] leading-relaxed font-medium"
                        style={{ color: 'var(--c-text)' }}
                      >
                        {current.fact}
                      </p>
                      <p className="text-xs mt-6" style={{ color: 'var(--c-muted)' }}>
                        Ещё раз — вернуть вопрос
                      </p>
                    </div>
                  </div>
                </button>

                {flipped ? (
                  <div className="w-full max-w-sm grid grid-cols-2 gap-3 flex-shrink-0">
                    <button
                      type="button"
                      onClick={handleKnown}
                      className="h-14 rounded-2xl text-[15px] font-bold active:scale-[0.97] transition-transform"
                      style={{
                        background: 'color-mix(in srgb, var(--c-primary) 14%, var(--c-card))',
                        border: '2px solid var(--c-primary-br)',
                        color: 'var(--c-text)',
                      }}
                    >
                      ✅ Знаю
                    </button>
                    <button
                      type="button"
                      onClick={handleUnknown}
                      className="h-14 rounded-2xl text-[15px] font-bold active:scale-[0.97] transition-transform"
                      style={{
                        background: 'var(--c-danger-soft)',
                        border: '2px solid hsl(var(--destructive) / 0.35)',
                        color: 'var(--c-text)',
                      }}
                    >
                      ❌ Не знаю
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-center" style={{ color: 'var(--c-muted)' }}>
                    Карточка {knownCount + unknownCount + 1} из {knownCount + unknownCount + remaining}
                  </p>
                )}
              </>
            ) : (
              <div className="text-center" style={{ color: 'var(--c-muted)' }}>
                <Loader2 className="w-6 h-6 animate-spin mx-auto" />
              </div>
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {topicModalOpen && (
          <TopicPickerModal
            onClose={() => setTopicModalOpen(false)}
            topicFilter={topicFilter}
            topicStats={topicStats}
            allTotal={allTotal}
            allWeak={allWeak}
            accentColor={accentColor}
            onSelect={applyTopicFilter}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
