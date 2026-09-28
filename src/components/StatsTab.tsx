"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ScrollArea }     from '@/components/ui/scroll-area';
import {
  BookOpen, ClipboardList, PenTool, Trash2, Sun, Moon, Sparkles,
  Award, ChevronRight, Calendar, Pencil,
} from 'lucide-react';
import { FacultyIcon }     from './FacultyIcon';
import { AppBrandIcon }     from './AppBrandIcon';
import { SubjectType }   from '@/components/SubjectSelectScreen';
import { SUBJECTS, getSubject, APP_BRAND_NAME } from '@/lib/subjects';
import { loadSubjectData } from '@/lib/subjectData';
import { motion, AnimatePresence } from 'framer-motion';
import { ExamScreen, loadExamHistory, ExamHistoryEntry } from './ExamScreen';
import { ResourcesSheet } from './ResourcesSheet';
import { BindUniversityForm } from './BindUniversityForm';
import type { UniversityProfile } from '@/lib/universityParser';
import {
  buildExamTicketsForSubject,
  getExamTicketCompositionLabel,
  hasExamTicketData,
  type ExamTicket,
} from '@/lib/examTickets';
import { restartCoachTour } from '@/lib/coachTour';

// ─── Types ────────────────────────────────────────────────────────────────────
type Theme = 'dark' | 'light' | 'bright';

const THEMES: { id: Theme; label: string; icon: React.ReactNode }[] = [
  { id: 'dark',   label: 'Тёмная',  icon: <Moon     className="w-[13px] h-[13px]" /> },
  { id: 'light',  label: 'Светлая', icon: <Sun      className="w-[13px] h-[13px]" /> },
  { id: 'bright', label: 'Яркая',   icon: <Sparkles className="w-[13px] h-[13px]" /> },
];

const MONTHS_GEN = [
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря',
];

function daysWord(n: number): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b > 1 && b < 5)   return 'дня';
  if (b === 1)          return 'день';
  return 'дней';
}

// ─── Кольцо прогресса (SVG) ───────────────────────────────────────────────────
const Ring: React.FC<{ pct: number; color: string; size?: number; stroke?: number; label: string; sub?: string }> =
({ pct, color, size = 128, stroke = 12, label, sub }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--c-border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <div className="font-bold leading-none" style={{ fontSize: 30, color: 'var(--c-text)', letterSpacing: -1 }}>{label}</div>
        {sub && <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>{sub}</div>}
      </div>
    </div>
  );
};

// ─── Subject bottom-sheet ─────────────────────────────────────────────────────
interface SubjectSheetProps {
  currentSubject:    SubjectType;
  onSelect:          (s: SubjectType) => void;
  onClose:           () => void;
  hasMicro?:         boolean;
  availableSubjects?: string[];
  pendingPaymentSubject?: string | null;
  onBrowseCatalog?:  () => void;
  browseCatalogBusy?: boolean;
  sheetTitle?:       string;
  showCatalogAction?: boolean;
}

const SubjectSheet: React.FC<SubjectSheetProps> = ({
  currentSubject, onSelect, onClose,
  hasMicro = false,
  availableSubjects,
  pendingPaymentSubject = null,
  onBrowseCatalog,
  browseCatalogBusy = false,
  sheetTitle = 'Мои предметы',
  showCatalogAction = false,
}) => {
  const [selected, setSelected] = useState<SubjectType>(currentSubject);
  const userSubjects: string[] = availableSubjects
    ?? ['ortho', ...(hasMicro ? ['micro'] : [])];

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const items = SUBJECTS
    .filter(s => userSubjects.includes(s.id))
    .map(s => ({
      id:      s.id as SubjectType,
      label:   s.label,
      sub:     s.sub,
      color:   s.color,
      dimVar:  s.dimColor,
      brVar:   s.borderColor,
      variant: s.iconVariant,
    }));

  if (!mounted) return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 flex flex-col justify-end"
      style={{ zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="rounded-t-[28px] flex flex-col"
        style={{ background: 'var(--c-card)', borderTop: '1px solid var(--c-border)', maxHeight: '85vh' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--c-border)' }} />
        </div>
        <div className="text-center px-5 pb-3 pt-1 flex-shrink-0">
          <h3 className="text-base font-bold" style={{ color: 'var(--c-text)' }}>{sheetTitle}</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
            {items.length === 0
              ? 'Нет открытых дисциплин'
              : sheetTitle === 'Мои предметы'
                ? `Открыто: ${items.length} ${items.length === 1 ? 'предмет' : items.length < 5 ? 'предмета' : 'предметов'}`
                : `Доступно: ${items.length} ${items.length === 1 ? 'предмет' : items.length < 5 ? 'предмета' : 'предметов'}`}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <div className="flex flex-col gap-2.5 py-2">
            {items.map(item => {
              const isSel = selected === item.id;
              const isCur = currentSubject === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelected(item.id);
                    onSelect(item.id);
                    onClose();
                  }}
                  className="flex items-center gap-3 rounded-[18px] p-3.5 text-left transition-all duration-200 active:scale-[0.98]"
                  style={{
                    background: isSel ? item.dimVar : 'color-mix(in srgb, var(--c-border) 25%, transparent)',
                    border: `1.5px solid ${isSel ? item.brVar : 'var(--c-border)'}`,
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
                    style={{ background: item.dimVar, border: `1px solid ${item.brVar}` }}
                  >
                    <FacultyIcon size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="text-[13px] font-bold leading-tight" style={{ color: 'var(--c-text)' }}>{item.label}</span>
                      {isCur && (
                        <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0"
                          style={{ background: item.dimVar, color: item.color }}>Сейчас</span>
                      )}
                      {pendingPaymentSubject === item.id && (
                        <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24' }}>Оплата</span>
                      )}
                    </div>
                    <span className="text-[10.5px] block whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: 'var(--c-muted)' }}>
                      {item.sub}
                    </span>
                  </div>
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center transition-all duration-200"
                    style={{ background: isSel ? item.color : 'transparent', border: `1.5px solid ${isSel ? item.color : 'var(--c-border)'}` }}
                  >
                    {isSel && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5 3.5-4" stroke="var(--c-bg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="flex-shrink-0 px-5 pt-2 pb-5"
          style={{
            background: 'linear-gradient(to top, var(--c-card) 70%, transparent)',
            borderTop: '1px solid color-mix(in srgb, var(--c-border) 50%, transparent)',
          }}
        >
          {showCatalogAction && onBrowseCatalog && (
            <button
              type="button"
              disabled={browseCatalogBusy}
              onClick={() => { if (browseCatalogBusy) return; onClose(); onBrowseCatalog(); }}
              className="w-full py-3 mb-3 rounded-[16px] font-bold text-[13px] transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
              style={{
                background: 'var(--c-primary-soft)',
                border: '1.5px solid var(--c-primary-br)',
                color: 'var(--c-text)',
              }}
            >
              {browseCatalogBusy ? 'Открываем…' : 'Все доступные разработки'}
            </button>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-[16px] font-bold text-[13px] transition-all duration-200 active:scale-[0.98]"
              style={{ background: 'var(--c-border)', color: 'var(--c-text)' }}
            >
              Отмена
            </button>
            <button
              onClick={() => { onSelect(selected); onClose(); }}
              className="flex-1 py-3 rounded-[16px] font-bold text-[13px] transition-all duration-200 active:scale-[0.98]"
              style={{ background: getSubject(selected)?.color || 'var(--c-primary)', color: 'var(--c-bg)', cursor: 'pointer' }}
            >
              Выбрать
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
};

// ─── StatsTab ─────────────────────────────────────────────────────────────────
interface StatsTabProps {
  subject:           SubjectType;
  onSubjectChange:   (s: SubjectType) => void;
  hasMicro?:         boolean;
  onMicroUnlocked?:  () => void;
  availableSubjects?: string[];
  pendingPaymentSubject?: string | null;
  onBrowseCatalog?:  () => void;
  browseCatalogBusy?: boolean;
  onCheckPaymentStatus?: () => void;
  checkPaymentBusy?: boolean;
  /** Скрыть блок «Проверка готовности» (управляется из админки per-user) */
  examHidden?:      boolean;
  /** Скрыть раздел «Полезные материалы» (управляется из админки per-user) */
  materialsHidden?: boolean;
}

export const StatsTab: React.FC<StatsTabProps> = ({
  subject, onSubjectChange,
  hasMicro = false, onMicroUnlocked,
  availableSubjects,
  pendingPaymentSubject = null,
  onBrowseCatalog,
  browseCatalogBusy = false,
  onCheckPaymentStatus,
  checkPaymentBusy = false,
  examHidden      = false,
  materialsHidden = false,
}) => {
  const cfg     = getSubject(subject);
  const isOrtho = subject === 'ortho';

  const [counts, setCounts] = useState<{ q: number; t: number; ts: number }>({ q: 0, t: 0, ts: 0 });
  const [examTickets, setExamTickets] = useState<ExamTicket[]>([]);
  const [questionsData, setQuestionsData] = useState<unknown[]>([]);
  const [tasksData, setTasksData] = useState<unknown[]>([]);

  useEffect(() => {
    let cancelled = false;
    setCounts({ q: 0, t: 0, ts: 0 });
    setExamTickets([]);
    setQuestionsData([]);
    setTasksData([]);
    Promise.all([
      loadSubjectData(subject, 'questions'),
      loadSubjectData(subject, 'tasks'),
      loadSubjectData(subject, 'tests'),
    ]).then(([q, t, ts]) => {
      if (cancelled) return;
      setQuestionsData(q);
      setTasksData(t);
      setCounts({ q: q.length, t: t.length, ts: ts.length });
      setExamTickets(buildExamTicketsForSubject(subject, q, t));
    });
    return () => { cancelled = true; };
  }, [subject]);

  const currentTickets = examTickets;
  const examTicketsOfficial = subject === 'ortho' || subject === 'pharma';
  const pharmaOfficialCount = subject === 'pharma'
    ? currentTickets.filter(t => !t.isRandom).length
    : 0;

  // localStorage ключи (раздельный прогресс по предметам)
  const LS = {
    studied:    isOrtho ? 'studiedQuestions' : `${cfg?.lsPrefix || subject}_studiedQuestions`,
    tasks:      isOrtho ? 'resolvedTasks'     : `${cfg?.lsPrefix || subject}_resolvedTasks`,
    testScores: isOrtho ? 'test_block_scores' : `${cfg?.lsPrefix || subject}_test_block_scores`,
    examDate:   `exam_date:${subject}`,
  };

  const [studiedCount,       setStudiedCount]       = useState(0);
  const [resolvedTasksCount, setResolvedTasksCount] = useState(0);
  const [testsResolvedCount, setTestsResolvedCount] = useState(0);
  const [theme,              setTheme]              = useState<Theme>('dark');
  const [glossaryColor,      setGlossaryColor]      = useState<string>('var(--c-text)');
  const [showSubjectSheet,   setShowSubjectSheet]   = useState(false);
  const [showResources,      setShowResources]      = useState(false);
  const [showExam,           setShowExam]           = useState(false);
  const [examHistory,        setExamHistory]        = useState<ExamHistoryEntry[]>([]);
  const [examDate,           setExamDate]           = useState<string | null>(null);
  const [krasgmuProfile,     setKrasgmuProfile]     = useState<UniversityProfile | null>(null);
  const [krasgmuPhotoUrl,    setKrasgmuPhotoUrl]    = useState<string | null>(null);

  const handleKrasgmuProfile = useCallback((profile: UniversityProfile | null, photoUrl: string | null) => {
    setKrasgmuProfile(profile);
    setKrasgmuPhotoUrl(photoUrl);
  }, []);

  const dateInputRef = useRef<HTMLInputElement>(null);

  const reloadExamHistory = () => setExamHistory(loadExamHistory(subject));
  useEffect(() => { reloadExamHistory(); /* eslint-disable-next-line */ }, [subject]);

  // ── Дата экзамена (per-subject, localStorage) ────────────────────────────
  useEffect(() => {
    try { setExamDate(localStorage.getItem(LS.examDate)); }
    catch { setExamDate(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const saveExamDate = (iso: string) => {
    if (!iso) return;
    localStorage.setItem(LS.examDate, iso);
    setExamDate(iso);
  };
  const clearExamDate = () => {
    localStorage.removeItem(LS.examDate);
    setExamDate(null);
  };
  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker — современный API; fallback на focus/click
    try { (el as any).showPicker?.(); } catch {}
    el.focus();
  };

  const total = counts;

  // ── Тема ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('bright'))     setTheme('bright');
    else if (root.classList.contains('dark'))  setTheme('dark');
    else                                       setTheme('light');
  }, []);

  // ── Цвет глоссария ────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('glossary_color') || 'var(--c-text)';
    setGlossaryColor(saved);
    document.documentElement.style.setProperty('--c-glossary', saved);
  }, []);

  const applyGlossaryColor = (color: string) => {
    setGlossaryColor(color);
    document.documentElement.style.setProperty('--c-glossary', color);
    localStorage.setItem('glossary_color', color);
  };

  const applyTheme = (t: Theme) => {
    const root = document.documentElement;
    root.classList.remove('dark', 'bright');
    if (t === 'dark')   root.classList.add('dark');
    if (t === 'bright') root.classList.add('dark', 'bright');
    localStorage.setItem('theme', t);
  };

  // ── Прогресс ─────────────────────────────────────────────────────────────
  const loadStats = () => {
    try { setStudiedCount(JSON.parse(localStorage.getItem(LS.studied) || '[]').length); }       catch { setStudiedCount(0); }
    try { setResolvedTasksCount(JSON.parse(localStorage.getItem(LS.tasks) || '[]').length); }   catch { setResolvedTasksCount(0); }
    try {
      const sc = JSON.parse(localStorage.getItem(LS.testScores) || '{}');
      setTestsResolvedCount(Math.min(
        Object.values(sc).reduce((a: number, b: any) => a + b, 0) as number,
        total.ts,
      ));
    } catch { setTestsResolvedCount(0); }
  };

  const resetAll = () => {
    if (!window.confirm('⚠️ Прогресс по этому предмету будет сброшен. Заметки останутся.')) return;
    [LS.studied, LS.tasks, LS.testScores].forEach(k => localStorage.removeItem(k));
    loadStats();
  };

  useEffect(() => {
    loadStats();
    const onVisible = () => { if (document.visibilityState === 'visible') loadStats(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, total.ts]);

  const pct = {
    q:  total.q  ? (studiedCount       / total.q)  * 100 : 0,
    t:  total.t  ? (resolvedTasksCount / total.t)  * 100 : 0,
    ts: total.ts ? (testsResolvedCount / total.ts) * 100 : 0,
  };
  const overall = Math.round((pct.q + pct.t + pct.ts) / 3);

  const accentColor  = cfg?.color || 'var(--c-primary)';
  const subjectLabel = cfg?.label || 'Ортопедия';

  const grade = overall >= 80 ? 'отлично' : overall >= 60 ? 'хорошо' : overall >= 35 ? 'идём' : 'старт';

  // дни до экзамена
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const examDt = examDate ? new Date(examDate + 'T00:00:00') : null;
  const daysLeft = examDt ? Math.ceil((examDt.getTime() - today.getTime()) / 86400000) : null;
  const examPassed = daysLeft !== null && daysLeft < 0;
  const dateLabel = examDt
    ? `${examDt.getDate()} ${MONTHS_GEN[examDt.getMonth()]} ${examDt.getFullYear()}`
    : null;

  const tiles = [
    { label: 'Вопросы', icon: <BookOpen      className="w-3.5 h-3.5" />, count: studiedCount,       tot: total.q,  p: Math.round(pct.q),  color: 'var(--c-info)'    },
    { label: 'Задачи',  icon: <PenTool       className="w-3.5 h-3.5" />, count: resolvedTasksCount, tot: total.t,  p: Math.round(pct.t),  color: accentColor        },
    { label: 'Тесты',   icon: <ClipboardList className="w-3.5 h-3.5" />, count: testsResolvedCount, tot: total.ts, p: Math.round(pct.ts), color: 'var(--c-amber)'   },
  ];

  const bestPct = examHistory.length
    ? Math.max(...examHistory.map(h => Math.round((h.score / h.total) * 100)))
    : 0;
  const lastTry = examHistory[examHistory.length - 1];
  const enoughData = hasExamTicketData(subject, questionsData, tasksData);

  return (
    <>
      <div
        className="flex flex-col h-full overflow-x-hidden max-w-full select-none"
        style={{ background: 'var(--c-bg)', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
      >
       {/* ─── ШАПКА ─── */}
              <div
                className="px-4 pt-1 pb-3 sticky top-0 z-10"
                style={{
                  background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
                  backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                  borderBottom: '1px solid var(--c-border)',
                  /* Тот же отступ, что и везде */
                  paddingTop: 'max(12px, calc(var(--header-pt) - 24px))',
                }}
              >
                <div className="flex items-start justify-between px-1">
                  {/* 1. Левая безопасная зона */}
                  <div className="w-[75px] flex-shrink-0" />

                  {/* 2. Центрированный блок */}
                  <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <AppBrandIcon />
                      <h1 className="text-[16px] font-bold tracking-tight leading-tight truncate" style={{ color: 'var(--c-text)' }}>
                        {APP_BRAND_NAME}
                      </h1>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mt-1 mb-1 text-center" style={{ color: accentColor }}>
                      Статистика · {cfg?.label || subject}
                    </p>
                  </div>

                  {/* 3. Правая безопасная зона (вместо корзины) */}
                  <div className="w-[75px] flex-shrink-0" />
                </div>
              </div>

        <ScrollArea className="flex-1 px-4 scroll-container">
          <div className="space-y-3.5 mx-auto max-w-2xl pt-4" style={{ paddingBottom: 'var(--scroll-pb)' }}>

            {/* ─── HERO: кольцо готовности + дата экзамена ─── */}
            <div
              className="rounded-[20px] p-4"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            >
              {krasgmuProfile && (
                <div
                  className="flex items-center gap-2.5 pb-3 mb-3.5"
                  style={{ borderBottom: '1px solid var(--c-border)' }}
                >
                  {krasgmuPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={krasgmuPhotoUrl}
                      alt=""
                      className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                      style={{ border: '1px solid var(--c-border)' }}
                    />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold"
                      style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
                    >
                      {krasgmuProfile.fullName.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold truncate" style={{ color: 'var(--c-text)' }}>
                      {krasgmuProfile.fullName}
                    </div>
                    {krasgmuProfile.course && krasgmuProfile.group && (
                      <div className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                        {krasgmuProfile.course} курс · гр. {krasgmuProfile.group}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-4">
                {/* Обертка для кольца с обработчиком двойного тапа */}
        <div 
          className="flex flex-col items-center justify-center cursor-pointer select-none active:scale-[0.98] transition-transform"
          onDoubleClick={(e) => {
            e.preventDefault();
            resetAll();
          }}
        >
          <Ring pct={overall} color={accentColor} size={128} stroke={12} label={`${overall}%`} sub={grade} />
          
          {/* Микро-подсказка */}
          <span className="text-[8px] uppercase tracking-wider font-bold mt-1.5 opacity-40" style={{ color: 'var(--c-muted)' }}>
            2x тап = сброс
          </span>
        </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                    {examPassed ? 'Экзамен' : 'До экзамена'}
                  </div>
                  {examDt ? (
                    <>
                      {examPassed ? (
                        <div className="text-[15px] font-bold mt-1" style={{ color: 'var(--c-text)' }}>
                          Прошёл
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <div className="font-bold leading-none" style={{ fontSize: 34, color: 'var(--c-text)', letterSpacing: -1.5 }}>
                            {daysLeft}
                          </div>
                          <div className="text-[13px] font-medium" style={{ color: 'var(--c-muted)' }}>
                            {daysWord(daysLeft as number)}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                        <button
                          onClick={openDatePicker}
                          className="px-2.5 py-1.5 rounded-[9px] text-[12px] font-semibold inline-flex items-center gap-1.5"
                          style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary-strong)', border: '1px solid var(--c-primary-br)' }}
                        >
                          <Calendar className="w-3 h-3" /> {dateLabel}
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button
                          onClick={clearExamDate}
                          className="text-[11px] font-semibold"
                          style={{ color: 'var(--c-muted)' }}
                        >
                          сбросить
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={openDatePicker}
                      className="mt-2 px-3 py-2.5 rounded-[11px] text-[13px] font-bold inline-flex items-center gap-2 active:scale-[0.97]"
                      style={{ background: accentColor, color: 'var(--c-bg)', border: 'none' }}
                    >
                      <Calendar className="w-3.5 h-3.5" /> Установить дату
                    </button>
                  )}
                  {/* Нативный date-picker (скрыт; открывается кнопками выше) */}
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={examDate || ''}
                    onChange={e => saveExamDate(e.target.value)}
                    className="sr-only"
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>

            {/* ─── 3 ПЛИТКИ ПРОГРЕССА ─── */}
            <div className="grid grid-cols-3 gap-2">
              {tiles.map(s => (
                <div
                  key={s.label}
                  className="rounded-[14px] p-2.5 flex flex-col gap-2"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="w-[26px] h-[26px] rounded-lg flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)`, color: s.color }}
                    >
                      {s.icon}
                    </div>
                    <span className="text-[13px] font-mono font-bold" style={{ color: s.color }}>{s.p}%</span>
                  </div>
                  <div>
                    <div className="text-[18px] font-bold leading-none" style={{ color: 'var(--c-text)', letterSpacing: -0.5 }}>
                      {s.count}<span className="text-[11px] font-normal" style={{ color: 'var(--c-text-faint)' }}>/{s.tot}</span>
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide mt-1" style={{ color: 'var(--c-muted)' }}>
                      {s.label}
                    </div>
                  </div>
                  <div className="h-[3px] w-full rounded-full overflow-hidden" style={{ background: 'var(--c-bg-subtle)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, s.p)}%`, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>

            {/* ─── ПРИВЯЗКА КРАСГМУ ─── */}
            <BindUniversityForm onProfileChange={handleKrasgmuProfile} />

            {/* ─── ПРОВЕРКА ГОТОВНОСТИ + ГРАФИК ─── */}
            {!examHidden && (
              <>
                <button
                  onClick={() => enoughData && setShowExam(true)}
                  disabled={!enoughData}
                  className="rounded-[18px] p-4 flex items-center gap-3.5 text-left transition active:scale-[0.99] w-full"
                  style={{
                    background: enoughData ? accentColor : 'var(--c-card)',
                    color:      enoughData ? 'var(--c-bg)' : 'var(--c-muted)',
                    boxShadow:  enoughData ? `0 8px 22px color-mix(in srgb, ${accentColor} 34%, transparent)` : 'none',
                    border:     enoughData ? 'none' : '1px solid var(--c-border)',
                    opacity:    enoughData ? 1 : 0.7,
                    cursor:     enoughData ? 'pointer' : 'not-allowed',
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
                    style={{ background: enoughData ? 'rgba(255,255,255,0.2)' : 'var(--c-border)' }}
                  >
                    <Award className="w-[22px] h-[22px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold">
                      {enoughData ? 'Экзаменационные билеты' : 'Экзамен недоступен'}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ opacity: 0.9 }}>
                      {enoughData
                        ? lastTry
                          ? `Лучший: ${bestPct}% · попыток: ${examHistory.length}`
                          : examTicketsOfficial
                            ? subject === 'pharma'
                              ? `${pharmaOfficialCount} официальных + ${currentTickets.length - pharmaOfficialCount} сборных · ${currentTickets.length} билетов`
                              : 'Официальные билеты · 20 минут'
                            : `${currentTickets.length} билетов · ${getExamTicketCompositionLabel(questionsData.length)}`
                        : `Нужны вопросы и задачи (${getExamTicketCompositionLabel(questionsData.length)})`}
                    </div>
                  </div>
                  {enoughData && <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ opacity: 0.8 }} />}
                </button>

                {examHistory.length > 0 && enoughData && (
                  <div className="rounded-[16px] p-3.5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                          История попыток
                        </div>
                        <div className="text-[13px] font-semibold mt-0.5" style={{ color: 'var(--c-text)' }}>
                          Последние {examHistory.length} {examHistory.length === 1 ? 'попытка' : examHistory.length < 5 ? 'попытки' : 'попыток'}
                        </div>
                      </div>
                      {lastTry && (
                        <div className="text-[10.5px] font-bold px-2.5 py-1 rounded-full"
                          style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary-strong)' }}>
                          посл. {Math.round((lastTry.score / lastTry.total) * 100)}%
                        </div>
                      )}
                    </div>
                    <div className="flex items-end gap-1.5 mb-2" style={{ height: 88 }}>
                      {Array.from({ length: 10 }).map((_, idx) => {
                        const entry = examHistory[idx];
                        const p = entry ? Math.round((entry.score / entry.total) * 100) : 0;
                        const empty = !entry;
                        const barColor =
                          empty ? 'var(--c-border)' :
                          !entry.finished ? 'var(--c-text-faint)' :
                          p >= 67 ? accentColor :
                          p >= 34 ? 'var(--c-amber)' : 'var(--c-danger)';
                        return (
                          <div key={idx} className="flex-1 flex flex-col justify-end items-center gap-1" style={{ height: '100%' }}>
                            {entry && (
                              <span className="text-[9px] font-mono font-bold" style={{ color: barColor }}>{p}</span>
                            )}
                            <div
                              className="w-full rounded-md transition-all duration-700"
                              style={{
                                height: empty ? '10%' : `${Math.max(10, p)}%`,
                                background: barColor,
                                opacity: empty ? 0.35 : 1,
                                border: empty ? '1px dashed var(--c-border)' : 'none',
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--c-text-faint)' }}>
                      <span>← старые</span>
                      <span>новые →</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ─── ПЕРЕКЛЮЧАТЕЛЬ ТЕМ (slim) ─── */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color: 'var(--c-muted)' }}>
                Тема
              </span>
              <div
                className="flex-1 grid grid-cols-3 gap-1.5 p-1 rounded-[12px]"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              >
                {THEMES.map(tm => {
                  const active = theme === tm.id;
                  return (
                    <button
                      key={tm.id}
                      onClick={() => { setTheme(tm.id); applyTheme(tm.id); }}
                      className="h-[31px] rounded-[9px] inline-flex items-center justify-center gap-1.5 text-[12px] font-bold transition-all duration-150 active:scale-95"
                      style={active
                        ? { background: 'var(--c-primary)', color: '#fff' }
                        : { background: 'transparent', color: 'var(--c-text)' }}
                    >
                      <span style={{ color: active ? '#fff' : 'var(--c-muted)' }}>{tm.icon}</span>
                      {tm.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ─── ЦВЕТ ГЛОССАРИЯ ─── */}
            {(() => {
              const GLOSSARY_COLORS = [
                { id: 'var(--c-text)',    label: 'Текст',      dot: 'var(--c-text)'    },
                { id: 'var(--c-primary)', label: 'Основной',   dot: 'var(--c-primary)' },
                { id: 'var(--c-info)',    label: 'Синий',      dot: 'var(--c-info)'    },
                { id: 'var(--c-amber)',   label: 'Янтарный',   dot: 'var(--c-amber)'   },
                { id: 'hsl(280 60% 62%)', label: 'Фиолетовый', dot: 'hsl(280 60% 62%)' },
              ];
              return (
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color: 'var(--c-muted)' }}>
                    Глоссарий
                  </span>
                  <div
                    className="flex-1 flex gap-2 p-1 rounded-[12px] items-center justify-around"
                    style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
                  >
                    {GLOSSARY_COLORS.map(c => {
                      const active = glossaryColor === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => applyGlossaryColor(c.id)}
                          className="transition-all duration-150 active:scale-90 rounded-full flex-shrink-0"
                          style={{
                            width: 28, height: 28,
                            background: c.dot,
                            border: active ? '3px solid var(--c-text)' : '3px solid transparent',
                            outline: active ? '2px solid var(--c-card)' : 'none',
                            outlineOffset: -5,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ─── ПОЛЕЗНЫЕ МАТЕРИАЛЫ ─── */}
            {!materialsHidden && <button
              onClick={() => setShowResources(true)}
              className="w-full rounded-[18px] p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.98]"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-[20px]"
                style={{ background: `color-mix(in srgb, ${accentColor} 14%, transparent)`, border: '1px solid var(--c-border)' }}
              >
                📚
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Полезные материалы</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                  Ссылки, PDF, презентации, документы
                </div>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            </button>}

            {/* ─── КАК ПОЛЬЗОВАТЬСЯ ─── */}
            <button
              type="button"
              onClick={() => restartCoachTour()}
              className="w-full rounded-[18px] p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.98]"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-[20px]"
                style={{ background: `color-mix(in srgb, ${accentColor} 14%, transparent)`, border: '1px solid var(--c-border)' }}
              >
                👋
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Как пользоваться</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                  Короткий тур по кнопкам внизу — ещё раз
                </div>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            </button>

            {/* ─── МОИ ПРЕДМЕТЫ ─── */}
            <button
              onClick={() => setShowSubjectSheet(true)}
              className="w-full rounded-[18px] p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.98]"
              style={{ background: 'var(--c-primary-soft)', border: '1.5px solid var(--c-primary-br)' }}
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-primary-br)' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3l4 4-4 4" /><path d="M20 7H4" />
                  <path d="M8 21l-4-4 4-4" /><path d="M4 17h16" />
                </svg>
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Сменить предмет</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                  Сейчас: <span style={{ color: 'var(--c-text)', fontWeight: 600 }}>{subjectLabel}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            </button>

            {onBrowseCatalog && (
              <button
                onClick={() => { if (!browseCatalogBusy) onBrowseCatalog(); }}
                disabled={browseCatalogBusy}
                className="w-full rounded-[18px] p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-[20px]"
                  style={{ background: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
                >
                  ✨
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Докупить другой предмет</div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                    Витрина — пробный доступ к новым разработкам
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
              </button>
            )}

            {onCheckPaymentStatus && (
              <button
                onClick={() => { if (!checkPaymentBusy) onCheckPaymentStatus(); }}
                disabled={checkPaymentBusy}
                className="w-full rounded-[18px] p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.25)' }}
                >
                  <span className="text-[18px]">⏳</span>
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>Проверить статус оплаты</div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                    Обновить — подтвердил ли админ доступ
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: '#fbbf24' }} />
              </button>
            )}

          </div>
        </ScrollArea>
      </div>

      {/* Полезные материалы */}
      <AnimatePresence>
        {showResources && (
          <ResourcesSheet
            subject={subject}
            accentColor={accentColor}
            onClose={() => setShowResources(false)}
          />
        )}
      </AnimatePresence>

      {/* Subject bottom sheet */}
      <AnimatePresence>
        {showSubjectSheet && (
          <SubjectSheet
            currentSubject={subject}
            onSelect={s => { onSubjectChange(s); setShowSubjectSheet(false); }}
            onClose={() => setShowSubjectSheet(false)}
            hasMicro={hasMicro}
            availableSubjects={availableSubjects}
            pendingPaymentSubject={pendingPaymentSubject}
            sheetTitle="Мои предметы"
            showCatalogAction={false}
          />
        )}
      </AnimatePresence>

      {/* Экзамен */}
      <AnimatePresence>
        {showExam && (
          <ExamScreen
            subject={subject}
            subjectLabel={subjectLabel}
            accentColor={accentColor}
            dimColor={cfg?.dimColor || 'var(--c-primary-dim)'}
            borderColor={cfg?.borderColor || 'var(--c-primary-br)'}
            ticketsData={currentTickets}
            onClose={() => { setShowExam(false); reloadExamHistory(); loadStats(); }}
            onResultSaved={reloadExamHistory}
          />
        )}
      </AnimatePresence>
    </>
  );
};
