"use client";

// ════════════════════════════════════════════════════════════════════════════
//  ExamScreen — модал «Проверка готовности» (режим фиксированных билетов)
//
//  Логика:
//    1. Главный режим — «вытянуть билет» (случайный) либо выбрать из сетки.
//       «Тренировка» отключает таймер; «Слабые» выбирает худший/неоткрытый билет.
//    2. Таймер 20 минут (только в режиме «Экзамен»). Виден номер билета.
//    3. На экране вопроса — анимированный зуб («подумай»), затем «Показать ответ».
//    4. Юзер видит эталон → отмечает «Знаю» / «Не знаю».
//    5. После 3-го ответа — экран результата с поразборным списком билета.
//    6. Результат пишется в localStorage с номером билета.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Clock, Check, XCircle, RefreshCw, BookOpen, Dices,
  Eye, ChevronLeft, Zap, Target, Medal,
} from 'lucide-react';

// ─── Типы ───────────────────────────────────────────────────────────────────
interface RawItem {
  id: number | string;
  question: string;
  answer: string;
}

interface Item extends RawItem {
  type: 'question' | 'task';
}

export interface Ticket {
  id: number | string;
  ticketNumber: string | number;
  questions: RawItem[]; // массив из 2 элементов
  task: RawItem;        // 1 элемент (может быть пустым)
  /** Сборный билет из неиспользованных вопросов/задач. */
  isRandom?: boolean;
}

export interface ExamHistoryEntry {
  ts:          number;
  score:       number;
  total:       number;
  durationSec: number;
  finished:    boolean;
  ticketId?:   string | number;
}

type ExamMode = 'exam' | 'train';

interface ExamScreenProps {
  subject:        string;
  subjectLabel:   string;
  accentColor:    string;
  dimColor:       string;
  borderColor:    string;
  ticketsData:    Ticket[];
  onClose:        () => void;
  onResultSaved?: () => void;
}

// ─── Константы ──────────────────────────────────────────────────────────────
const EXAM_DURATION_SEC = 20 * 60;
const HISTORY_MAX       = 30;

// ─── localStorage helpers ───────────────────────────────────────────────────
export function getExamHistoryKey(subjectId: string): string {
  return subjectId === 'ortho' ? 'exam_history' : `${subjectId}_exam_history`;
}

export function loadExamHistory(subjectId: string): ExamHistoryEntry[] {
  try {
    const raw = localStorage.getItem(getExamHistoryKey(subjectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveExamResult(subjectId: string, entry: ExamHistoryEntry) {
  const history = loadExamHistory(subjectId);
  history.push(entry);
  const trimmed = history.slice(-HISTORY_MAX);
  localStorage.setItem(getExamHistoryKey(subjectId), JSON.stringify(trimmed));
}

/** Лучший результат (%) по каждому билету. */
function bestByTicket(subjectId: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const h of loadExamHistory(subjectId)) {
    if (h.ticketId === undefined || !h.total) continue;
    const pct = Math.round((h.score / h.total) * 100);
    const key = String(h.ticketId);
    if (map[key] === undefined || pct > map[key]) map[key] = pct;
  }
  return map;
}

// ─── Форматирование ─────────────────────────────────────────────────────────
function fmtTime(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
//  Анимированный «думающий» зуб
// ════════════════════════════════════════════════════════════════════════════
const ThinkingTooth: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const sparks = [
    { top: '6%',  left: '18%', d: '0s',   s: 13 },
    { top: '16%', left: '82%', d: '0.7s', s: 10 },
    { top: '74%', left: '8%',  d: '1.4s', s: 9 },
    { top: '82%', left: '80%', d: '0.4s', s: 12 },
  ];
  return (
    <div style={{ position: 'relative', width: 168, height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', border: `2px solid ${accentColor}`, animation: 'examPulse 2.6s ease-out infinite' }} />
      <span style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', border: `2px solid ${accentColor}`, animation: 'examPulse 2.6s ease-out infinite', animationDelay: '1.3s' }} />
      <span style={{ position: 'absolute', width: '72%', height: '72%', borderRadius: '50%', background: `radial-gradient(circle, color-mix(in srgb, ${accentColor} 18%, transparent) 0%, transparent 70%)`, animation: 'examGlow 2.6s ease-in-out infinite' }} />
      {sparks.map((sp, i) => (
        <svg key={i} width={sp.s} height={sp.s} viewBox="0 0 24 24" fill={accentColor}
          style={{ position: 'absolute', top: sp.top, left: sp.left, opacity: 0, animation: 'examSpark 3s ease-in-out infinite', animationDelay: sp.d }}>
          <path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z" />
        </svg>
      ))}
      <div style={{ position: 'relative', animation: 'examFloat 3.4s ease-in-out infinite', zIndex: 2 }}>
        <svg width={94} height={94} viewBox="0 0 24 24" fill="none"
          stroke={accentColor} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M12 2c-3.5 0-7 1.5-7 5 0 2.5 1 4.5 1.5 6 0.5 1.5 1 5 1.5 8 0.5 2 2 2 2.5 0 0.4-1.6 0.6-3.5 1.5-3.5s1.1 1.9 1.5 3.5c0.5 2 2 2 2.5 0 0.5-3 1-6.5 1.5-8C18 11.5 19 9.5 19 7c0-3.5-3.5-5-7-5z"
            fill={`color-mix(in srgb, ${accentColor} 10%, transparent)`}
          />
        </svg>
        <div style={{
          position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)',
          width: 74, height: 3, borderRadius: 99,
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
          animation: 'examScan 2.2s ease-in-out infinite',
        }} />
      </div>

      <style>{`
        @keyframes examPulse { 0% { transform: scale(0.62); opacity: 0.55; } 80% { opacity: 0; } 100% { transform: scale(1.05); opacity: 0; } }
        @keyframes examGlow  { 0%,100% { transform: scale(0.9); opacity: 0.7; } 50% { transform: scale(1.05); opacity: 1; } }
        @keyframes examFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
        @keyframes examScan  { 0% { top: 14%; opacity: 0; } 25% { opacity: 0.9; } 75% { opacity: 0.9; } 100% { top: 82%; opacity: 0; } }
        @keyframes examSpark { 0%,100% { opacity: 0; transform: scale(0.5); } 50% { opacity: 0.9; transform: scale(1); } }
      `}</style>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  Компонент
// ════════════════════════════════════════════════════════════════════════════
export const ExamScreen: React.FC<ExamScreenProps> = ({
  subject, subjectLabel, accentColor, dimColor, borderColor,
  ticketsData, onClose, onResultSaved,
}) => {
  const [phase, setPhase] = useState<'intro'|'question'|'answer'|'result'|'no-data'>('intro');
  const [mode, setMode] = useState<ExamMode>('exam');
  const [items, setItems] = useState<Item[]>([]);
  const [currentTicket, setCurrentTicket] = useState<string | number>('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<boolean[]>([]);   // знаю/не знаю по каждому
  const [secondsLeft, setSecondsLeft] = useState(EXAM_DURATION_SEC);
  const [confirmExit, setConfirmExit] = useState(false);
  const startTimeRef = useRef<number>(0);
  const finalDurationRef = useRef<number>(0);
  const finishedRef = useRef<boolean>(false);
  const prevBestRef = useRef<number | null>(null);   // лучший % по этому билету ДО попытки

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Статусы билетов из истории
  const ticketBest = useMemo(() => (mounted ? bestByTicket(subject) : {}), [mounted, subject, phase]);

  // Заглушка, если данных нет
  useEffect(() => {
    if (!ticketsData || ticketsData.length === 0) setPhase('no-data');
  }, [ticketsData]);

  // Таймер (только режим «Экзамен»)
  useEffect(() => {
    if (mode !== 'exam') return;
    if (phase !== 'question' && phase !== 'answer') return;
    const t = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { finishExam(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode]);

  // ─── Кастомный рендер текста ───
  const renderFormattedText = (text: string) => {
    if (!text) return null;
    return (
      <div className="w-full break-words whitespace-pre-wrap [word-break:break-word]">
        {text.split('\n').map((line, lineIdx) => {
          let isBoldState = false;
          let isItalicState = false;
          if (line.trim() === '') return <div key={lineIdx} className="h-1" />;

          const listMatch = line.match(/^(\s*[•\-\*]\s+|\s*\d+\.\s+)/);
          const isListItem = !!listMatch;
          let listMarker = isListItem ? listMatch![1].trim() : '';
          if (listMarker === '-' || listMarker === '*') listMarker = '•';
          const cleanLine = isListItem ? line.replace(/^(\s*[•\-\*]\s+|\s*\d+\.\s+)/, '') : line;
          const tokens = cleanLine.split(/(\*\*|_)/g);

          const renderedTokens = tokens.map((token, tIdx) => {
            if (!token) return null;
            if (token === '**') { isBoldState = !isBoldState; return null; }
            if (token === '_')  { isItalicState = !isItalicState; return null; }
            const baseStyle: React.CSSProperties = {
              fontWeight: isBoldState ? 700 : 'inherit',
              color: isBoldState ? 'var(--c-text)' : 'inherit',
              fontStyle: isItalicState ? 'italic' : 'normal',
            };
            return <span key={`text-${lineIdx}-${tIdx}`} style={baseStyle}>{token}</span>;
          });

          if (isListItem) {
            return (
              <div key={lineIdx} className="flex gap-2 mb-1.5 pl-2 mt-1">
                <span className="text-[14px] leading-snug font-bold" style={{ color: accentColor }}>{listMarker}</span>
                <p className="m-0 flex-1 leading-snug">{renderedTokens}</p>
              </div>
            );
          }
          return <p key={lineIdx} className="indent-4 mb-2 mt-1 last:mb-0">{renderedTokens}</p>;
        })}
      </div>
    );
  };

  // Старт экзамена
  const startExam = (ticketId?: string | number, examMode: ExamMode = mode) => {
    let selectedTicket: Ticket | undefined;

    if (ticketId !== undefined) {
      selectedTicket = ticketsData.find(t => t.id === ticketId);
    } else {
      selectedTicket = ticketsData[Math.floor(Math.random() * ticketsData.length)];
    }
    if (!selectedTicket) { setPhase('no-data'); return; }

    const pickedItems: Item[] = [
      ...selectedTicket.questions
        .filter((q): q is RawItem => !!q?.question)
        .map((q): Item => ({ ...q, type: 'question' })),
      { ...selectedTicket.task, type: 'task' },
    ].filter((item): item is Item => !!item.question);

    const prevBest = ticketBest[String(selectedTicket.id)];
    prevBestRef.current = prevBest === undefined ? null : prevBest;

    setMode(examMode);
    setItems(pickedItems);
    setCurrentTicket(selectedTicket.ticketNumber);
    setCurrentIdx(0);
    setScore(0);
    setAnswers([]);
    setSecondsLeft(EXAM_DURATION_SEC);
    startTimeRef.current = Date.now();
    finishedRef.current = false;
    setPhase('question');
  };

  // «Слабые темы» — билет с худшим/отсутствующим результатом
  const startWeakest = () => {
    if (!ticketsData.length) { setPhase('no-data'); return; }
    let worst = ticketsData[0];
    let worstPct = Infinity;
    for (const tk of ticketsData) {
      const pct = ticketBest[String(tk.id)];
      const val = pct === undefined ? -1 : pct;   // неоткрытый = приоритет
      if (val < worstPct) { worstPct = val; worst = tk; }
    }
    startExam(worst.id, 'train');
  };

  // Завершение по таймеру
  const finishExam = (_manual: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    finalDurationRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
    saveExamResult(subject, {
      ts: startTimeRef.current, score, total: items.length || 3,
      durationSec: finalDurationRef.current, finished: true, ticketId: currentTicket,
    });
    onResultSaved?.();
    setPhase('result');
  };

  // Самооценка
  const handleSelfGrade = (knew: boolean) => {
    const newScore = knew ? score + 1 : score;
    const newAnswers = [...answers, knew];
    setScore(newScore);
    setAnswers(newAnswers);
    if (currentIdx + 1 >= items.length) {
      finishedRef.current = true;
      finalDurationRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
      saveExamResult(subject, {
        ts: startTimeRef.current, score: newScore, total: items.length,
        durationSec: finalDurationRef.current, finished: true, ticketId: currentTicket,
      });
      onResultSaved?.();
      setPhase('result');
    } else {
      setCurrentIdx(i => i + 1);
      setPhase('question');
    }
  };

  // Прерывание
  const handleHardExit = () => {
    if (phase === 'question' || phase === 'answer') {
      const dur = Math.floor((Date.now() - startTimeRef.current) / 1000);
      saveExamResult(subject, {
        ts: startTimeRef.current, score, total: items.length,
        durationSec: dur, finished: false, ticketId: currentTicket,
      });
      onResultSaved?.();
    }
    onClose();
  };

  if (!mounted) return null;

  // ── Подсчёты для UI ──
  const currentItem = items[currentIdx];
  const total       = items.length || 3;
  const progressPct = total > 0 ? ((currentIdx + (phase === 'answer' ? 0.5 : 0)) / total) * 100 : 0;
  const timerLow    = secondsLeft <= 120;
  const timerColor  = timerLow ? 'hsl(var(--destructive))' : accentColor;
  const inExam      = phase === 'question' || phase === 'answer';
  const passedCount = ticketsData.filter(t => ticketBest[String(t.id)] !== undefined).length;
  const perfectCount = ticketsData.filter(t => ticketBest[String(t.id)] === 100).length;
  const questionsPerTicket = ticketsData[0]?.questions?.length ?? 2;
  const ticketCompositionLabel = `${questionsPerTicket} вопроса + задача`;

  // ════════════════════════════════════════════════════════════════════════
  return createPortal(
    <motion.div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 9999, background: 'var(--c-bg)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* ── ШАПКА ── */}
      <div
        className="flex-shrink-0 sticky top-0 z-10 px-4 pb-3"
        style={{
          background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--c-border)',
          paddingTop: 'max(12px, calc(var(--header-pt) - 24px))',
        }}
      >
        <div className="flex items-start justify-between px-1">
          <div className="w-[75px] flex-shrink-0" />
          <div className="flex flex-col items-center justify-center flex-1 min-w-0">
            {inExam ? (
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {mode === 'exam' ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm tabular-nums"
                    style={{
                      background: timerLow ? 'hsla(var(--destructive), 0.12)' : dimColor,
                      color: timerColor,
                      border: `1px solid ${timerLow ? 'hsla(var(--destructive), 0.4)' : borderColor}`,
                    }}>
                    <Clock className="w-4 h-4" />{fmtTime(secondsLeft)}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[13px]"
                    style={{ background: dimColor, color: accentColor, border: `1px solid ${borderColor}` }}>
                    <BookOpen className="w-4 h-4" /> Тренировка
                  </div>
                )}
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-[13px]"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                  <BookOpen className="w-4 h-4" style={{ color: accentColor }} /> Билет {currentTicket}
                </div>
              </div>
            ) : (
              <>
                <div className="text-[15px] font-bold tracking-tight text-center" style={{ color: 'var(--c-text)' }}>
                  {phase === 'intro'   && 'Проверка готовности'}
                  {phase === 'result'  && 'Результат'}
                  {phase === 'no-data' && 'Экзамен недоступен'}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-widest mt-0.5 text-center" style={{ color: accentColor }}>
                  {subjectLabel}{phase === 'intro' && ticketsData.length > 0 ? ` · ${ticketsData.length} билетов` : ''}
                </div>
              </>
            )}
          </div>
          <div className="w-[75px] flex-shrink-0" />
        </div>
      </div>

      {/* ПРОГРЕСС-ТОЧКИ */}
      {inExam && (
        <div className="flex gap-1.5 px-4 pt-3" style={{ background: 'var(--c-bg)' }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className="flex-1 h-1 rounded-full transition-all duration-500"
              style={{
                background: i < currentIdx ? accentColor : i === currentIdx ? accentColor : 'var(--c-border)',
                opacity: i === currentIdx ? 0.45 : 1,
              }} />
          ))}
        </div>
      )}

      {/* ── СОДЕРЖИМОЕ ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-xl mx-auto px-4 py-4">

          {/* ════ INTRO ════ */}
          {phase === 'intro' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">

              {/* HERO — вытянуть билет */}
              <button
                onClick={() => startExam(undefined, 'exam')}
                className="relative overflow-hidden rounded-3xl p-5 text-left transition active:scale-[0.98]"
                style={{
                  background: `linear-gradient(135deg, ${accentColor} 0%, color-mix(in srgb, ${accentColor} 75%, #000) 100%)`,
                  color: '#fff',
                  boxShadow: `0 12px 30px color-mix(in srgb, ${accentColor} 40%, transparent)`,
                }}
              >
                <div className="absolute -right-5 -top-3 opacity-20" style={{ transform: 'rotate(14deg)' }}>
                  <Dices className="w-32 h-32" strokeWidth={1.2} />
                </div>
                <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ opacity: 0.85 }}>Главный режим</div>
                <div className="text-[24px] font-extrabold leading-tight mb-1.5" style={{ letterSpacing: '-0.5px' }}>Вытянуть билет</div>
                <div className="text-[13px] mb-4 max-w-[240px]" style={{ opacity: 0.9, lineHeight: 1.4 }}>
                  Случайный билет: {ticketCompositionLabel}. Таймер 20 минут — как на реальном экзамене.
                </div>
                <div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-bold"
                  style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)' }}>
                  <Dices className="w-5 h-5" /> Тянуть случайный
                </div>
              </button>

              {/* Доп. режимы */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => startExam(undefined, 'train')}
                  className="rounded-2xl p-4 text-left transition active:scale-[0.97] flex flex-col gap-2.5"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: 'var(--c-amber-dim)', color: 'var(--c-amber)' }}>
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Тренировка</div>
                    <div className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--c-muted)' }}>Случайный билет · без таймера</div>
                  </div>
                </button>

                <button onClick={startWeakest}
                  className="rounded-2xl p-4 text-left transition active:scale-[0.97] flex flex-col gap-2.5"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: 'hsla(var(--destructive), 0.1)', color: 'hsl(var(--destructive))' }}>
                    <Target className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Слабые темы</div>
                    <div className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--c-muted)' }}>Добор по проседающим</div>
                  </div>
                </button>
              </div>

              {/* Билеты + легенда */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Билеты</div>
                  <div className="flex items-center gap-3 text-[11px] font-semibold">
                    <span className="inline-flex items-center gap-1.5" style={{ color: accentColor }}>
                      <span className="w-2 h-2 rounded-sm" style={{ background: accentColor }} /> сдан {perfectCount}
                    </span>
                    <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--c-amber)' }}>
                      <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--c-amber)' }} /> начат
                    </span>
                    <span style={{ color: 'var(--c-muted)' }}>{passedCount}/{ticketsData.length}</span>
                  </div>
                </div>

                <div className="grid grid-cols-6 gap-2">
                  {ticketsData.map(ticket => {
                    const pct = ticketBest[String(ticket.id)];
                    const isPerfect = pct === 100;
                    const isTried = pct !== undefined && pct < 100;
                    const isRandom = ticket.isRandom === true;
                    return (
                      <button key={ticket.id} onClick={() => startExam(ticket.id)}
                        className="relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 transition active:scale-90"
                        style={{
                          background: isPerfect ? accentColor : isTried ? 'var(--c-amber-dim)' : 'var(--c-card)',
                          border: `1.5px ${isRandom && !isPerfect && !isTried ? 'dashed' : 'solid'} ${isPerfect ? accentColor : isTried ? 'var(--c-amber-br)' : 'var(--c-border)'}`,
                        }}>
                        {isPerfect && (
                          <Medal className="w-2.5 h-2.5 absolute top-1 right-1" style={{ color: 'rgba(255,255,255,0.9)' }} />
                        )}
                        {isRandom && !isPerfect && (
                          <span className="absolute top-0.5 right-0.5 text-[7px] font-bold leading-none opacity-50"
                            style={{ color: 'var(--c-muted)' }}>~</span>
                        )}
                        <span className="text-[15px] font-bold leading-none font-mono"
                          style={{ color: isPerfect ? '#fff' : 'var(--c-text)' }}>
                          {ticket.ticketNumber}
                        </span>
                        {pct !== undefined && (
                          <span className="text-[8.5px] font-bold font-mono leading-none"
                            style={{ color: isPerfect ? 'rgba(255,255,255,0.85)' : 'var(--c-amber)' }}>
                            {pct}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button onClick={onClose}
                className="w-full h-12 rounded-2xl font-semibold text-[14px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                style={{ background: dimColor, border: `1px solid ${borderColor}`, color: accentColor }}>
                <X className="w-4 h-4" /> Выйти
              </button>
            </motion.div>
          )}

          {/* ════ NO-DATA ════ */}
          {phase === 'no-data' && (
            <div className="text-center py-16 flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <BookOpen className="w-8 h-8" style={{ color: 'var(--c-muted)' }} />
              </div>
              <h3 className="text-base font-bold" style={{ color: 'var(--c-text)' }}>Билеты в разработке</h3>
              <p className="text-[13px] max-w-xs" style={{ color: 'var(--c-muted)' }}>
                Для этого предмета ещё не загружены экзаменационные билеты.
              </p>
              <button onClick={onClose}
                className="w-full max-w-xs h-12 rounded-2xl font-semibold text-[14px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                style={{ background: dimColor, border: `1px solid ${borderColor}`, color: accentColor }}>
                <X className="w-4 h-4" /> Выйти
              </button>
            </div>
          )}

          {/* ════ QUESTION ════ */}
          {phase === 'question' && currentItem && (
            <motion.div key={`q-${currentIdx}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="flex flex-col gap-4" style={{ minHeight: 'calc(100vh - var(--header-pt) - 120px)' }}>
              <span className="inline-block self-start text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide"
                style={{ background: dimColor, color: accentColor }}>
                {currentItem.type === 'question' ? `Вопрос ${currentIdx + 1} из ${total}` : `Задача · ${currentIdx + 1} из ${total}`}
              </span>

              <div className="text-[18px] font-semibold leading-snug" style={{ color: 'var(--c-text)', letterSpacing: '-0.2px' }}>
                {renderFormattedText(currentItem.question)}
              </div>

              {/* анимированный зуб */}
              <div className="flex-1 flex flex-col items-center justify-center gap-4 py-4">
                <ThinkingTooth accentColor={accentColor} />
                <div className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: 'var(--c-muted)' }}>
                  <Eye className="w-3.5 h-3.5" /> Сформулируйте ответ мысленно
                </div>
              </div>

              <button onClick={() => setPhase('answer')}
                className="w-full h-[54px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition active:scale-[0.98]"
                style={{ background: accentColor, color: 'var(--c-bg)', boxShadow: `0 8px 22px color-mix(in srgb, ${accentColor} 30%, transparent)` }}>
                <Eye className="w-5 h-5" /> Показать ответ
              </button>
              <button onClick={() => { if (mode === 'exam') setConfirmExit(true); else onClose(); }}
                className="w-full h-11 rounded-2xl font-semibold text-[13px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                style={{ background: dimColor, border: `1px solid ${borderColor}`, color: accentColor }}>
                <X className="w-4 h-4" /> Выйти из режима
              </button>
            </motion.div>
          )}

          {/* ════ ANSWER ════ */}
          {phase === 'answer' && currentItem && (
            <motion.div key={`a-${currentIdx}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="flex flex-col gap-3">
              <div className="rounded-2xl p-4" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: accentColor }}>
                  {currentItem.type === 'question' ? `Вопрос ${currentIdx + 1}` : 'Задача'}
                </div>
                <div className="text-[13.5px] leading-snug font-medium" style={{ color: 'var(--c-text)' }}>
                  {renderFormattedText(currentItem.question)}
                </div>
              </div>

              <div className="rounded-2xl p-4" style={{ background: 'var(--c-card)', border: `1.5px solid ${borderColor}` }}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: accentColor }}>
                  <span className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: accentColor }}>
                    <Check className="w-3 h-3" style={{ color: 'var(--c-bg)' }} strokeWidth={3} />
                  </span>
                  Эталонный ответ
                </div>
                <div className="text-[14px] leading-relaxed" style={{ color: 'var(--c-text)' }}>
                  {renderFormattedText(currentItem.answer)}
                </div>
              </div>

              <div className="text-[12px] text-center mt-1 mb-1" style={{ color: 'var(--c-muted)' }}>Честно оцените свой ответ</div>
              <div className="flex gap-3">
                <button onClick={() => handleSelfGrade(false)}
                  className="flex-1 h-[52px] rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                  style={{ background: 'hsla(var(--destructive), 0.1)', border: '1.5px solid hsla(var(--destructive), 0.3)', color: 'hsl(var(--destructive))' }}>
                  <XCircle className="w-5 h-5" /> Не знаю
                </button>
                <button onClick={() => handleSelfGrade(true)}
                  className="flex-1 h-[52px] rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                  style={{ background: accentColor, color: 'var(--c-bg)', boxShadow: `0 6px 16px color-mix(in srgb, ${accentColor} 30%, transparent)` }}>
                  <Check className="w-5 h-5" /> Знаю
                </button>
              </div>
              <button onClick={() => { if (mode === 'exam') setConfirmExit(true); else onClose(); }}
                className="w-full h-11 rounded-2xl font-semibold text-[13px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                style={{ background: dimColor, border: `1px solid ${borderColor}`, color: accentColor }}>
                <X className="w-4 h-4" /> Выйти из режима
              </button>
            </motion.div>
          )}

          {/* ════ RESULT ════ */}
          {phase === 'result' && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
              {(() => {
                const t = items.length || 3;
                const pct = Math.round((score / t) * 100);
                const color =
                  pct >= 90 ? accentColor :
                  pct >= 60 ? accentColor :
                  pct >= 34 ? 'var(--c-amber)' : 'hsl(var(--destructive))';
                const verdict =
                  pct >= 90 ? 'Отлично' :
                  pct >= 60 ? 'Хорошо' :
                  pct >= 34 ? 'Слабовато' : 'Подготовься ещё';

                const prevBest = prevBestRef.current;
                const delta = prevBest === null ? null : pct - prevBest;

                const ringR = 52, stroke = 11, sz = 132;
                const circ = 2 * Math.PI * ringR;
                const off = circ * (1 - pct / 100);

                return (
                  <>
                    {/* кольцо + вердикт */}
                    <div className="flex flex-col items-center gap-2.5 pt-2">
                      <div className="relative" style={{ width: sz, height: sz }}>
                        <svg width={sz} height={sz} style={{ transform: 'rotate(-90deg)' }}>
                          <circle cx={sz/2} cy={sz/2} r={ringR} stroke="var(--c-border)" strokeWidth={stroke} fill="none" />
                          <circle cx={sz/2} cy={sz/2} r={ringR} stroke={color} strokeWidth={stroke} fill="none"
                            strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="text-[34px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--c-text)', letterSpacing: '-1px' }}>
                            {score}<span className="text-[18px] font-medium" style={{ color: 'var(--c-muted)' }}>/{t}</span>
                          </div>
                          <div className="text-[11px] font-bold uppercase tracking-wider mt-0.5" style={{ color }}>{pct}%</div>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[20px] font-bold" style={{ color: 'var(--c-text)', letterSpacing: '-0.3px' }}>{verdict}</div>
                        <div className="text-[12.5px] mt-1 flex items-center gap-1.5 justify-center flex-wrap" style={{ color: 'var(--c-muted)' }}>
                          <Clock className="w-3.5 h-3.5" /> {fmtTime(finalDurationRef.current)} · Билет {currentTicket}
                          {delta !== null && delta > 0 && (
                            <span style={{ color: accentColor, fontWeight: 700 }}>· +{delta}% к лучшему</span>
                          )}
                          {delta === null && (
                            <span style={{ color: accentColor, fontWeight: 700 }}>· первая попытка</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* поразборный список */}
                    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                      <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                        Разбор билета
                      </div>
                      {items.map((it, i) => {
                        const knew = answers[i];
                        return (
                          <div key={i} className="px-4 py-2.5 flex items-center gap-3" style={{ borderTop: '1px solid var(--c-border)' }}>
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{
                                background: knew ? dimColor : 'hsla(var(--destructive), 0.1)',
                                color: knew ? accentColor : 'hsl(var(--destructive))',
                              }}>
                              {knew ? <Check className="w-4 h-4" strokeWidth={2.6} /> : <XCircle className="w-4 h-4" strokeWidth={2.4} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
                                {it.type === 'question' ? `Вопрос ${i + 1}` : 'Задача'}
                              </div>
                              <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--c-text)' }}>
                                {it.question.replace(/\*\*/g, '').slice(0, 60) || '—'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* CTA */}
                    <div className="flex flex-col gap-2.5">
                      <button onClick={() => startExam(undefined, mode)}
                        className="w-full h-[52px] rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                        style={{ background: accentColor, color: 'var(--c-bg)', boxShadow: `0 6px 16px color-mix(in srgb, ${accentColor} 30%, transparent)` }}>
                        <Dices className="w-4 h-4" /> Тянуть следующий билет
                      </button>
                      <button onClick={() => setPhase('intro')}
                        className="w-full h-[52px] rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                        style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                        <ChevronLeft className="w-4 h-4" /> К списку билетов
                      </button>
                      <button onClick={onClose}
                        className="w-full h-11 rounded-2xl font-semibold text-[13px] flex items-center justify-center gap-2 transition active:scale-[0.97]"
                        style={{ background: dimColor, border: `1px solid ${borderColor}`, color: accentColor }}>
                        <X className="w-4 h-4" /> Выйти
                      </button>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}

        </div>
      </div>

      {/* ── Confirm exit ── */}
      <AnimatePresence>
        {confirmExit && (
          <motion.div className="fixed inset-0 flex items-center justify-center px-5"
            style={{ zIndex: 10000, background: 'rgba(0,0,0,0.55)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setConfirmExit(false)}>
            <motion.div className="rounded-3xl p-5 max-w-xs w-full"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}>
              <div className="text-base font-bold mb-2" style={{ color: 'var(--c-text)' }}>Прервать экзамен?</div>
              <div className="text-[13px] mb-5" style={{ color: 'var(--c-muted)' }}>
                Текущая попытка по Билету {currentTicket} ({score}/{items.length}) сохранится как незавершённая.
              </div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmExit(false)} className="flex-1 h-11 rounded-xl font-bold text-[13px] active:scale-[0.97] transition-transform duration-150"
                  style={{ background: 'var(--c-border)', color: 'var(--c-text)' }}>Продолжить</button>
                <button onClick={handleHardExit} className="flex-1 h-11 rounded-xl font-bold text-[13px] active:scale-[0.97] transition-transform duration-150"
                  style={{ background: 'hsl(var(--destructive))', color: 'var(--c-bg)' }}>Выйти</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body
  );
};
