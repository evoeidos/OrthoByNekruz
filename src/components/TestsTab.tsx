// ── TestsTab.tsx ──────────────────────────────────────────────────────────────
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SubjectType } from '@/components/SubjectSelectScreen';
import { getSubject, APP_BRAND_NAME } from '@/lib/subjects';
import { loadSubjectData } from '@/lib/subjectData';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CheckCircle2, XCircle, RotateCcw, Zap, ChevronLeft, Search, Check,
  Medal, Pencil, Trash2, FileText, Shuffle, AlertTriangle, Flame,
  Award, ArrowRight, ArrowLeft, ChevronDown, BookOpen, Lightbulb,
  Settings2, LogOut, List, SlidersHorizontal,
  X,
} from 'lucide-react';
import { isCorrectTestOption, normalizeTestOptionText, resolveCorrectOption } from '@/lib/testAnswers';
import {
  DEFAULT_TESTS_PER_BLOCK, MIN_TESTS_PER_BLOCK, MAX_TESTS_PER_BLOCK, TESTS_PER_BLOCK_PRESETS,
  LS_TESTS_PER_BLOCK, clampTestsPerBlock, blockStorageKey,
} from '@/lib/testBlocks';

import { AppBrandIcon } from './AppBrandIcon';
import ReactMarkdown from 'react-markdown';
import { RichText, GlossaryItem } from '@/components/RichText';
import { itemRelatedTerms, filterValidGlossary } from '@/lib/glossaryUtils';

// ─── Types ────────────────────────────────────────────────────────────────────
type BlockId = number | 'mistakes' | 'exam' | 'favorites';

interface MistakeRecord {
  id: string;
  question: string;
  options: string[];
  correct: string;
  ts: number;
}

/** Как открывается блок: решать тест или читать «вопрос — ответ» списком. */
type OpenMode = 'solve' | 'list';

interface TestBlock {
  id: number;
  localId: number;
  /** Номер первого теста блока (с 1) — для нумерации в списке */
  start: number;
  range: string;
  questions: any[];
  size: number;
  best: number;
  status: 'perfect' | 'started' | 'new';
}

const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];

const LONG_PRESS_MS = 500;

const LS_OPEN_MODE = 'tests_open_mode';

/** Текст правильного ответа без метки варианта («2) …», «а) …»). */
const correctAnswerText = (test: { options: string[]; correct: string }): string => {
  const raw = resolveCorrectOption(test) || '';
  return normalizeTestOptionText(raw) || raw.trim();
};

// ─── Block button (shared between flat and themed grids) ──────────────────────
const BlockButton = ({
  b, onSelect, onStudySelect,
}: {
  b: Pick<TestBlock, 'id' | 'localId' | 'range' | 'size' | 'best' | 'status'>;
  onSelect: () => void;
  onStudySelect: () => void;
}) => {
  const isPerfect = b.status === 'perfect';
  const isStarted = b.status === 'started';
  const accent = isPerfect ? 'var(--c-primary)' : isStarted ? 'var(--c-amber)' : 'var(--c-text-faint)';
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    longPressTriggered.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      onStudySelect();
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = () => clearLongPress();
  const handlePointerLeave = () => clearLongPress();

  const handleClick = () => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    onSelect();
  };

  return (
    <button
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      onContextMenu={e => e.preventDefault()}
      className="rounded-[13px] flex flex-col items-center justify-between transition-all active:scale-95 relative overflow-hidden select-none touch-manipulation"
      style={{
        width: '100%', aspectRatio: '1 / 1.12', padding: '7px 5px 6px',
        background: isPerfect ? 'var(--c-primary-soft)' : isStarted ? 'var(--c-amber-soft)' : 'var(--c-card)',
        border: `1.5px solid ${isPerfect ? 'var(--c-primary-br)' : isStarted ? 'var(--c-amber-br)' : 'var(--c-border)'}`,
      }}>
      {isPerfect && <div className="absolute top-1.5 right-1.5" style={{ color: 'var(--c-amber)' }}><Medal className="w-[11px] h-[11px]" /></div>}
      <div className="text-[20px] font-bold leading-none mt-1.5"
        style={{ color: isPerfect ? 'var(--c-primary)' : 'var(--c-text)', letterSpacing: -0.5 }}>{b.localId}</div>
      <div className="text-[8.5px] font-mono font-bold uppercase" style={{ color: 'var(--c-text-faint)' }}>{b.range}</div>
      <div className="w-full flex flex-col items-center gap-1">
        {b.best > 0 && (
          <span className="text-[9px] font-mono font-bold" style={{ color: accent }}>{b.best}/{b.size}</span>
        )}
        <div className="h-[3px] rounded-full overflow-hidden" style={{ width: 'calc(100% - 4px)', background: 'var(--c-bg-subtle)' }}>
          <div className="h-full rounded-full" style={{ width: `${(b.best / b.size) * 100}%`, background: accent }} />
        </div>
      </div>
    </button>
  );
};

// ─── Подсказка: эффективное обучение ─────────────────────────────────────────
const STUDY_HINT_TITLE = 'Подсказка: как учить тест эффективнее';

const BlockOpenHint = ({
  expanded = false,
  onToggle,
  variant = 'card',
  showHintAttention = false,
}: {
  expanded?: boolean;
  onToggle?: () => void;
  variant?: 'card' | 'dialog';
  showHintAttention?: boolean;
}) => {
  const rows = [
    {
      Icon: BookOpen,
      title: 'Удержи блок ~½ сек',
      subtitle: 'Режим обучения',
      desc: 'Правильные ответы видны сразу. Пройди блок один раз, чтобы запомнить, потом проверяй себя.',
      color: 'var(--c-amber)',
      bg: 'color-mix(in srgb, var(--c-amber) 18%, transparent)',
    },
    {
      Icon: Check,
      title: 'Короткое нажатие',
      subtitle: 'Режим проверки',
      desc: 'Отвечай сам. Первый раз — с подсветкой, повтор — строго. Включи «Подсказку» внизу, если застрял — уберёт два неверных варианта.',
      color: 'var(--c-primary)',
      bg: 'var(--c-primary-dim)',
    },
  ] as const;

  const rowList = (large: boolean) => (
    <div>
      <p className={`${large ? 'text-[12px]' : 'text-[11px]'} leading-snug mb-2.5`} style={{ color: 'var(--c-muted)' }}>
        Есть 2 режима:
      </p>
      <div className={large ? 'space-y-3' : 'flex flex-col gap-2.5'}>
      {rows.map(r => (
        <div key={r.title} className={`flex items-start ${large ? 'gap-3' : 'gap-2.5'}`}>
          <div
            className={`${large ? 'w-9 h-9 rounded-xl' : 'w-8 h-8 rounded-[10px]'} flex items-center justify-center flex-shrink-0`}
            style={{ background: r.bg, color: r.color }}
          >
            <r.Icon className={large ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className={`${large ? 'text-[13px]' : 'text-[12.5px]'} font-bold`} style={{ color: 'var(--c-text)' }}>{r.title}</span>
              <span className={`${large ? 'text-[11.5px]' : 'text-[11px]'} font-bold`} style={{ color: r.color }}>→ {r.subtitle}</span>
            </div>
            <p className={`${large ? 'text-[12px]' : 'text-[11px]'} leading-snug mt-1`} style={{ color: 'var(--c-muted)' }}>{r.desc}</p>
          </div>
        </div>
      ))}
      </div>
    </div>
  );

  const drawAttention = showHintAttention;

  if (variant === 'dialog') return rowList(true);

  return (
    <>
      {drawAttention && (
        <style>{`
          @keyframes testsHintGlow {
            0%, 100% {
              box-shadow: 0 0 0 0 color-mix(in srgb, var(--c-amber) 0%, transparent);
            }
            50% {
              box-shadow:
                0 0 0 2px color-mix(in srgb, var(--c-amber) 28%, transparent),
                0 6px 18px color-mix(in srgb, var(--c-amber) 16%, transparent);
            }
          }
          @keyframes testsHintShimmer {
            0% { transform: translateX(-130%); opacity: 0; }
            12% { opacity: 0.85; }
            45% { opacity: 0.85; }
            58% { opacity: 0; }
            100% { transform: translateX(230%); opacity: 0; }
          }
          @keyframes testsHintBulb {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.12); }
          }
          @keyframes testsHintBadge {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.72; transform: scale(0.96); }
          }
        `}</style>
      )}
      <div
        className="relative mb-3 rounded-[13px] overflow-hidden"
        style={{
          background: 'var(--c-amber-soft)',
          border: '1px solid color-mix(in srgb, var(--c-amber) 32%, transparent)',
          animation: drawAttention ? 'testsHintGlow 2.8s ease-in-out infinite' : undefined,
        }}
      >
        {drawAttention && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[13px]">
            <div
              className="absolute inset-y-0 w-[42%]"
              style={{
                background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--c-amber) 42%, transparent), transparent)',
                animation: 'testsHintShimmer 4.2s ease-in-out infinite',
              }}
            />
          </div>
        )}
        {drawAttention && (
          <span
            className="absolute top-2 right-9 z-10 text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md pointer-events-none"
            style={{
              background: 'var(--c-amber)',
              color: 'var(--c-bg)',
              animation: 'testsHintBadge 2.8s ease-in-out infinite',
            }}
          >
            Совет
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="relative z-[1] w-full px-3 py-2.5 flex items-center gap-2 text-left transition-all active:opacity-80"
        >
          <Lightbulb
            className="w-3.5 h-3.5 flex-shrink-0"
            style={{
              color: 'var(--c-amber)',
              animation: drawAttention ? 'testsHintBulb 2.8s ease-in-out infinite' : undefined,
            }}
          />
          <span className="flex-1 text-[11px] font-bold leading-snug pr-10" style={{ color: 'var(--c-text)' }}>
            <span style={{ color: 'var(--c-amber)' }}>Подсказка:</span> как учить тест эффективнее
          </span>
          <ChevronDown
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{ color: 'var(--c-muted)', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        </button>
        {expanded && <div className="relative z-[1] px-3 pb-3">{rowList(false)}</div>}
      </div>
    </>
  );
};

// ─── Компактная кнопка режима (экзамен / ошибки / избранное) ───────────────────
const QuickModeButton = ({
  onClick, Icon, title, subtitle, badge, color,
}: {
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  badge?: string;
  color: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full rounded-[12px] px-3 py-2.5 flex items-center gap-2.5 text-left transition-all active:scale-[0.99]"
    style={{ background: 'var(--c-card)', border: `1px solid color-mix(in srgb, ${color} 22%, var(--c-border))` }}
  >
    <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center flex-shrink-0"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <Icon className="w-[14px] h-[14px]" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12.5px] font-bold truncate" style={{ color: 'var(--c-text)' }}>{title}</span>
        {badge && (
          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
            style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
            {badge}
          </span>
        )}
      </div>
      <div className="text-[10.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>{subtitle}</div>
    </div>
    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--c-text-faint)' }} />
  </button>
);

// ─── Component ────────────────────────────────────────────────────────────────
export const TestsTab = ({
  onSecretTap,
  subject = 'ortho',
  onTestModeChange,
  bustDataCache = false,
}: {
  onSecretTap?: () => void;
  subject?: SubjectType;
  /** Сообщает родителю, что открыт блок теста (чтобы скрыть навигацию) */
  onTestModeChange?: (active: boolean) => void;
  bustDataCache?: boolean;
}) => {
  const cfg          = getSubject(subject);
  const accentColor  = cfg?.color || 'var(--c-primary)';
  // Размер блока выбирает студент — результаты и попытки хранятся отдельно для каждого размера
  const [testsPerBlock, setTestsPerBlock] = useState(DEFAULT_TESTS_PER_BLOCK);
  const lsScores     = blockStorageKey(subject === 'ortho' ? 'test_block_scores' : `${cfg?.lsPrefix || subject}_test_block_scores`, testsPerBlock);
  const lsNote       = subject === 'ortho' ? 'tests_personal_note'  : `${cfg?.lsPrefix || subject}_tests_personal_note`;
  const lsMistakes   = subject === 'ortho' ? 'test_mistakes'        : `${cfg?.lsPrefix || subject}_test_mistakes`;
  const lsFavorites  = subject === 'ortho' ? 'test_favorites'       : `${cfg?.lsPrefix || subject}_test_favorites`;
  const lsAttempts   = blockStorageKey(subject === 'ortho' ? 'test_block_attempts' : `${cfg?.lsPrefix || subject}_test_block_attempts`, testsPerBlock);
  const lsOnboarding = 'tests_mode_onboarding_dismissed';
  const lsStudyHintOpened = 'tests_study_hint_opened';
  // ── Data ──────────────────────────────────────────────────────────────────
  const [loadedTestsData, setLoadedTestsData] = useState<any[]>([]);
  const [microLoading,    setMicroLoading]    = useState(false);
  const testsData = loadedTestsData;
  const [dynamicGlossary, setDynamicGlossary] = useState<GlossaryItem[]>([]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedBlock,    setSelectedBlock]    = useState<BlockId | null>(null);
  const [currentTestIndex, setCurrentTestIndex] = useState(0);
  const [selectedOption,   setSelectedOption]   = useState<string | null>(null);
  const [showResult,       setShowResult]       = useState(false);
  const [scoredAnswers,    setScoredAnswers]    = useState<Record<number, { option: string; correct: boolean }>>({});
  const [reviewSelections, setReviewSelections] = useState<Record<number, string>>({});
  const [optionOrders,     setOptionOrders]     = useState<Record<number, string[]>>({});
  const [completed,        setCompleted]        = useState(false);
  const [autoNext,         setAutoNext]         = useState(false);
  const [shuffleOptions,   setShuffleOptions]   = useState(false);
  const [studyMode,        setStudyMode]        = useState(false);
  const [hintsEnabled,     setHintsEnabled]     = useState(false);
  const [forcedStudySession, setForcedStudySession] = useState(false);
  const [hintLevel,        setHintLevel]        = useState(0);
  const [hidden5050,       setHidden5050]       = useState<string[]>([]);
  const [blockAttempts,    setBlockAttempts]    = useState<Record<number, number>>({});
  const [showOnboarding,   setShowOnboarding]    = useState(false);
  const [onboardingDismiss,setOnboardingDismiss]= useState(false);
  const [search,           setSearch]           = useState('');
  const [bestScores,       setBestScores]       = useState<Record<number, number>>({});
  const [mistakes,         setMistakes]         = useState<MistakeRecord[]>([]);
  const [favorites,        setFavorites]        = useState<MistakeRecord[]>([]);
  const [examQuestions,    setExamQuestions]    = useState<any[]>([]);
  const [testSnapshot,     setTestSnapshot]     = useState<any[]>([]);
  const [testsNote,        setTestsNote]        = useState('');
  const [isEditingNote,    setIsNoteEditing]    = useState(false);
  const [localTestsNote,   setLocalTestsNote]   = useState('');
  const [prevBest,         setPrevBest]         = useState(0);
  const [expandedThemes,   setExpandedThemes]   = useState<Set<string>>(new Set());
  const [showByTheme,      setShowByTheme]      = useState(false);
  const [studyHintOpen,    setStudyHintOpen]    = useState(false);
  const [studyHintEverOpened, setStudyHintEverOpened] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const testScrollRef = useRef<HTMLDivElement>(null);
  const showResultRef = useRef(false);
  const [testSettingsOpen, setTestSettingsOpen] = useState(false);
  const [openMode,         setOpenMode]         = useState<OpenMode>('solve');
  const [listView,         setListView]         = useState<{ block: TestBlock; focusId?: string } | null>(null);
  const [blockSizeOpen,    setBlockSizeOpen]    = useState(false);
  const [blockSizeDraft,   setBlockSizeDraft]   = useState('');
  const listScrollRef = useRef<HTMLDivElement>(null);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_TESTS_PER_BLOCK);
      if (saved) setTestsPerBlock(clampTestsPerBlock(saved));
      if (localStorage.getItem(LS_OPEN_MODE) === 'list') setOpenMode('list');
    } catch {}
  }, []);

  useEffect(() => { setLocalTestsNote(testsNote); }, [testsNote]);

  useEffect(() => {
    if (isEditingNote && noteRef.current) {
      noteRef.current.focus();
      noteRef.current.setSelectionRange(noteRef.current.value.length, noteRef.current.value.length);
    }
  }, [isEditingNote]);

  useEffect(() => {
    try { setBestScores(JSON.parse(localStorage.getItem(lsScores) || '{}')); } catch {}
    try { setMistakes(JSON.parse(localStorage.getItem(lsMistakes) || '[]')); }  catch {}
    try { setFavorites(JSON.parse(localStorage.getItem(lsFavorites) || '[]')); } catch {}
    try { setBlockAttempts(JSON.parse(localStorage.getItem(lsAttempts) || '{}')); } catch {}
    setStudyHintEverOpened(!!localStorage.getItem(lsStudyHintOpened));
    setTestsNote(localStorage.getItem(lsNote) || '');
  }, [subject, lsScores, lsMistakes, lsFavorites, lsAttempts, lsNote, lsStudyHintOpened]);

  useEffect(() => {
    let cancelled = false;
    setMicroLoading(true);
    setLoadedTestsData([]);
    loadSubjectData(subject, 'tests', { bustCache: bustDataCache })
      .then(d => { if (!cancelled) setLoadedTestsData(d as any[]); })
      .finally(() => { if (!cancelled) setMicroLoading(false); });
    return () => { cancelled = true; };
  }, [subject, bustDataCache]);

  useEffect(() => {
    let cancelled = false;
    loadSubjectData(subject, 'glossary', { bustCache: bustDataCache })
      .then(d => { if (!cancelled) setDynamicGlossary(filterValidGlossary(d as GlossaryItem[])); });
    return () => { cancelled = true; };
  }, [subject, bustDataCache]);

  // Сообщаем родителю про режим теста (открыт блок или список) — чтобы скрыть навигацию.
  const blockOpen = selectedBlock !== null || listView !== null;
  useEffect(() => {
    onTestModeChange?.(blockOpen);
    return () => onTestModeChange?.(false);
  }, [blockOpen, onTestModeChange]);

  // Список «вопрос — ответ»: из поиска — к найденному вопросу, иначе с начала
  useEffect(() => {
    if (!listView) return;
    const target = listView.focusId ? document.getElementById(`test-list-${listView.focusId}`) : null;
    if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    else listScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [listView]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const TESTS_PER_BLOCK = testsPerBlock;
  const TOTAL_TESTS  = testsData.length;
  const TOTAL_BLOCKS = Math.ceil(TOTAL_TESTS / TESTS_PER_BLOCK);

  const processed = useMemo(() =>
    testsData.map(t => ({
      ...t,
      correctIndex: t.options.findIndex((o: string) => isCorrectTestOption(o, t.correct)),
    })),
    [testsData]);

  const hasThemes = useMemo(() => processed.some((t: any) => t.theme || t.topic), [processed]);

  // Плоские глобальные блоки — по TESTS_PER_BLOCK вопросов подряд, ID 1..N
  const blocks = useMemo((): TestBlock[] => Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
    const id = i + 1; const best = bestScores[id] || 0;
    const questions = processed.slice(i * TESTS_PER_BLOCK, (i + 1) * TESTS_PER_BLOCK);
    const size = questions.length;
    return {
      id, localId: id, start: i * TESTS_PER_BLOCK + 1,
      range: `${i * TESTS_PER_BLOCK + 1}–${Math.min((i + 1) * TESTS_PER_BLOCK, TOTAL_TESTS)}`,
      questions, size, best,
      status: (best === size ? 'perfect' : best > 0 ? 'started' : 'new') as 'perfect' | 'started' | 'new',
    };
  }), [bestScores, TOTAL_BLOCKS, TOTAL_TESTS, processed, TESTS_PER_BLOCK]);

  // Тема-блоки — отдельно, используют отрицательные ID чтобы не конфликтовать с плоскими
  const themeGroups = useMemo(() => {
    if (!hasThemes) return null;
    const groups: { theme: string; questions: any[] }[] = [];
    const themeIndex = new Map<string, number>();
    for (const q of processed) {
      const theme = (q as any).theme || (q as any).topic || 'Общий раздел';
      if (!themeIndex.has(theme)) {
        themeIndex.set(theme, groups.length);
        groups.push({ theme, questions: [] });
      }
      groups[themeIndex.get(theme)!].questions.push(q);
    }
    let blockId = -1;
    return groups.map(g => {
      const tblocks: TestBlock[] = [];
      for (let i = 0; i < g.questions.length; i += TESTS_PER_BLOCK) {
        const chunk = g.questions.slice(i, i + TESTS_PER_BLOCK);
        const size = chunk.length;
        tblocks.push({
          id: blockId--, localId: tblocks.length + 1, start: i + 1,
          range: `${i + 1}–${Math.min(i + TESTS_PER_BLOCK, g.questions.length)}`,
          questions: chunk, size, best: 0,
          status: 'new',
        });
      }
      return { theme: g.theme, blocks: tblocks };
    });
  }, [hasThemes, processed, TESTS_PER_BLOCK]);

  const perfectCount = useMemo(() => blocks.filter(b => b.status === 'perfect').length, [blocks]);
  const startedCount = useMemo(() => blocks.filter(b => b.status === 'started').length, [blocks]);

  const blockTests = testSnapshot;

  const questionBlockMap = useMemo(() => {
    const map = new Map<string, { blockId: number; indexInBlock: number }>();
    for (const block of blocks) {
      block.questions.forEach((q: any, idx: number) => {
        map.set(q.id, { blockId: block.id, indexInBlock: idx });
      });
    }
    return map;
  }, [blocks]);

  const searchResults = useMemo(() => {
    if (!search) return [];
    const t = search.toLowerCase();
    return processed.filter(x => x.id.toString().includes(t) || x.question.toLowerCase().includes(t)).slice(0, 50);
  }, [search, processed]);

  const currentTest = blockTests[currentTestIndex];

  const score = useMemo(
    () => Object.values(scoredAnswers).filter(a => a.correct).length,
    [scoredAnswers],
  );

  const options = useMemo(() => {
    if (!currentTest) return [];
    if (shuffleOptions) return optionOrders[currentTestIndex] ?? currentTest.options;
    return currentTest.options;
  }, [currentTest, shuffleOptions, optionOrders, currentTestIndex]);

  // Восстановление ответа и порядка вариантов при смене вопроса
  useEffect(() => {
    if (!currentTest) return;

    if (shuffleOptions) {
      setOptionOrders(prev => {
        if (prev[currentTestIndex]) return prev;
        const s = [...currentTest.options];
        for (let i = s.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [s[i], s[j]] = [s[j], s[i]];
        }
        return { ...prev, [currentTestIndex]: s };
      });
    }

    testScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentTestIndex, currentTest?.id, shuffleOptions]);

  const isRegularBlock = (id: BlockId | null): id is number =>
    id !== null && id !== 'mistakes' && id !== 'exam' && id !== 'favorites';

  const resetQuestionHints = () => {
    setHintLevel(0);
    setHidden5050([]);
  };

  const applyQuestionUi = (index: number) => {
    const scored = scoredAnswers[index];
    if (scored) {
      setSelectedOption(reviewSelections[index] ?? scored.option);
      setShowResult(true);
      showResultRef.current = true;
    } else {
      setSelectedOption(null);
      setShowResult(false);
      showResultRef.current = false;
    }
    resetQuestionHints();
  };

  const goToQuestion = (index: number) => {
    if (index < 0 || index >= blockTests.length) return;
    applyQuestionUi(index);
    setCurrentTestIndex(index);
  };

  const resetTest = () => {
    setTestSettingsOpen(false);
    showResultRef.current = false;
    setCurrentTestIndex(0);
    setSelectedOption(null);
    setShowResult(false);
    setScoredAnswers({});
    setReviewSelections({});
    setOptionOrders({});
    setCompleted(false);
    resetQuestionHints();
    setForcedStudySession(false);
  };

  const maybeShowOnboarding = () => {
    if (!localStorage.getItem(lsOnboarding)) setShowOnboarding(true);
  };

  const dismissOnboarding = () => {
    if (onboardingDismiss) localStorage.setItem(lsOnboarding, '1');
    setShowOnboarding(false);
  };

  const recordBlockAttempt = (blockId: number) => {
    setBlockAttempts(prev => {
      const updated = { ...prev, [blockId]: (prev[blockId] || 0) + 1 };
      localStorage.setItem(lsAttempts, JSON.stringify(updated));
      return updated;
    });
  };

  const startBlock = (b: TestBlock, entry: 'tap' | 'study') => {
    setTestSnapshot(b.questions || []);
    resetTest();
    setHintsEnabled(false);
    if (entry === 'study') {
      setStudyMode(true);
      setForcedStudySession(true);
      setAutoNext(true);
    } else {
      const firstPass = (blockAttempts[b.id] || 0) === 0;
      setStudyMode(firstPass);
      setForcedStudySession(false);
      setAutoNext(firstPass);
    }
    setSelectedBlock(b.id);
    maybeShowOnboarding();
  };

  /** Нажатие на блок: в режиме «Вопрос — ответ» открывает список, иначе тест. */
  const openBlock = (b: TestBlock, entry: 'tap' | 'study') => {
    if (openMode === 'list') {
      setListView({ block: b });
      return;
    }
    startBlock(b, entry);
  };

  const changeOpenMode = (mode: OpenMode) => {
    setOpenMode(mode);
    try { localStorage.setItem(LS_OPEN_MODE, mode); } catch {}
  };

  const applyBlockSize = (value: number) => {
    const size = clampTestsPerBlock(value);
    setTestsPerBlock(size);
    try { localStorage.setItem(LS_TESTS_PER_BLOCK, String(size)); } catch {}
    setBlockSizeDraft('');
    setBlockSizeOpen(false);
  };

  /** Блоки того же ряда (общий список или одна тема) — для «Следующий блок» в списке. */
  const blockSequence = (id: number): TestBlock[] =>
    id > 0 ? blocks : themeGroups?.find(g => g.blocks.some(b => b.id === id))?.blocks ?? [];

  const use5050Hint = () => {
    if (!currentTest || showResultRef.current || studyMode || !hintsEnabled || hintLevel >= 1) return;
    const wrong = currentTest.options.filter((o: string) => !isCorrectTestOption(o, currentTest.correct));
    const toHide = [...wrong].sort(() => Math.random() - 0.5).slice(0, Math.min(2, wrong.length));
    setHidden5050(toHide);
    setHintLevel(1);
  };

  const toggleStudyHint = () => {
    setStudyHintOpen(v => {
      const next = !v;
      if (next && !studyHintEverOpened) {
        setStudyHintEverOpened(true);
        localStorage.setItem(lsStudyHintOpened, '1');
      }
      return next;
    });
  };

  const toggleStudyMode = () => {
    if (showResultRef.current) return;
    setStudyMode(v => {
      const next = !v;
      if (next) {
        setHintsEnabled(false);
        resetQuestionHints();
        setAutoNext(true);
      }
      return next;
    });
  };

  const toggleHintsEnabled = () => {
    if (showResultRef.current || studyMode) return;
    setHintsEnabled(v => {
      const next = !v;
      if (!next) resetQuestionHints();
      return next;
    });
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const saveNote = (t: string) => {
    const s = t.replace(/<[^>]*>?/gm, '');
    setTestsNote(s); localStorage.setItem(lsNote, s);
  };

  const recordMistake = (test: any) => {
    setMistakes(prev => {
      const filtered = prev.filter(m => m.id !== test.id);
      const updated: MistakeRecord[] = [
        { id: test.id, question: test.question, options: test.options, correct: test.correct, ts: Date.now() },
        ...filtered,
      ].slice(0, 100);
      localStorage.setItem(lsMistakes, JSON.stringify(updated));
      return updated;
    });
  };

  const clearMistake = (test: any) => {
    setMistakes(prev => {
      const updated = prev.filter(m => m.id !== test.id);
      localStorage.setItem(lsMistakes, JSON.stringify(updated));
      return updated;
    });
  };

  const toggleFavorite = (test: any) => {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === test.id);
      const updated = exists
        ? prev.filter(f => f.id !== test.id)
        : [{ id: test.id, question: test.question, options: test.options, correct: test.correct, ts: Date.now() }, ...prev];
      localStorage.setItem(lsFavorites, JSON.stringify(updated));
      return updated;
    });
  };
  const isFavorite = (test: any) => favorites.some(f => f.id === test?.id);

  const startExam = () => {
    const all = [...processed];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const qs = all.slice(0, 100);
    setExamQuestions(qs);
    setTestSnapshot(qs);
    resetTest();
    setStudyMode(false);
    setHintsEnabled(false);
    setForcedStudySession(false);
    setSelectedBlock('exam');
    maybeShowOnboarding();
  };

  const prevQuestion = () => {
    if (currentTestIndex <= 0) return;
    goToQuestion(currentTestIndex - 1);
  };

  const nextQuestion = () => {
    if (currentTestIndex < blockTests.length - 1) {
      goToQuestion(currentTestIndex + 1);
    } else {
      if (isRegularBlock(selectedBlock)) {
        recordBlockAttempt(selectedBlock);
        if (!studyMode && selectedBlock > 0) {
          const nb = { ...bestScores };
          const cur = nb[selectedBlock] || 0;
          setPrevBest(cur);
          if (score > cur) {
            nb[selectedBlock] = score;
            setBestScores(nb);
            localStorage.setItem(lsScores, JSON.stringify(nb));
          }
        } else if (selectedBlock > 0) {
          setPrevBest(bestScores[selectedBlock] || 0);
        }
      }
      setCompleted(true);
    }
  };

  const handleSelect = (opt: string) => {
    const correct = isCorrectTestOption(opt, currentTest.correct);
    const alreadyScored = scoredAnswers[currentTestIndex] !== undefined;

    if (alreadyScored) {
      setReviewSelections(prev => ({ ...prev, [currentTestIndex]: opt }));
      setSelectedOption(opt);
      setShowResult(true);
      showResultRef.current = true;
      return;
    }

    if (showResultRef.current) return;
    showResultRef.current = true;
    setSelectedOption(opt);
    setShowResult(true);
    setScoredAnswers(prev => ({ ...prev, [currentTestIndex]: { option: opt, correct } }));

    if (correct) {
      clearMistake(currentTest);
      if (autoNext && currentTestIndex < blockTests.length - 1) setTimeout(nextQuestion, 450);
    } else {
      recordMistake(currentTest);
    }
  };

  const startFromQuestion = (id: string) => {
    const info = questionBlockMap.get(id);
    if (!info) return;
    const b = blocks.find(bl => bl.id === info.blockId);
    if (!b) return;
    if (openMode === 'list') {
      setListView({ block: b, focusId: id });
      return;
    }
    setTestSnapshot(b.questions || []);
    resetTest();
    const firstPass = (blockAttempts[b.id] || 0) === 0;
    setStudyMode(firstPass);
    setHintsEnabled(false);
    setForcedStudySession(false);
    setAutoNext(firstPass);
    setSelectedBlock(info.blockId);
    goToQuestion(info.indexInBlock);
    maybeShowOnboarding();
  };

  // ── Шапка (общая для экрана блоков) ──────────────────────────────────────
  const Header = () => (
  <div
    className="px-4 pt-1 pb-3 sticky top-0 z-10"
    style={{
      background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--c-border)',
      /* Тот же уменьшенный отступ, что и во вкладке вопросов */
      paddingTop: 'max(12px, calc(var(--header-pt) - 24px))',
    }}
  >
    <div className="flex items-start justify-between px-1">
      {/* 1. Левая безопасная зона */}
      <div className="w-[75px] flex-shrink-0" />

      {/* 2. Центрированный блок */}
      <div className="flex flex-col items-center justify-center flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <AppBrandIcon onClick={onSecretTap} />
          <h1 className="text-[16px] font-bold tracking-tight leading-tight truncate" style={{ color: 'var(--c-text)' }}>
            {APP_BRAND_NAME}
          </h1>
        </div>
        
        <div className="flex flex-col items-center mt-1">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5 text-center" style={{ color: accentColor }}>
            Тесты · {cfg?.label || subject}
          </p>
          
          {/* Плашка (pill) с количеством тестов вместо прогресс-бара */}
          <span
            className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: 'var(--c-chip)', color: 'var(--c-muted)' }}
          >
            {TOTAL_TESTS} тестов
          </span>
        </div>
      </div>

      {/* 3. Правая безопасная зона */}
      <div className="w-[75px] flex-shrink-0" />
    </div>
  </div>
);

  // ══════════════════════════════════════════════════════════════════════════
  // СПИСОК «ВОПРОС — ОТВЕТ» (только правильные ответы)
  // ══════════════════════════════════════════════════════════════════════════
  if (listView) {
    const lb = listView.block;
    const seq = blockSequence(lb.id);
    const nextBlock = seq[seq.findIndex(x => x.id === lb.id) + 1];
    const theme = lb.id < 0 ? themeGroups?.find(g => g.blocks.some(x => x.id === lb.id))?.theme : undefined;

    return (
      <div className="flex flex-col h-full overflow-hidden max-w-full" style={{ background: 'var(--c-bg)' }}>
        <div className="px-3.5 py-2.5 sticky top-0 z-20 flex items-center gap-2.5"
          style={{
            background: 'color-mix(in srgb, var(--c-bg) 95%, transparent)',
            backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--c-border)',
            paddingTop: 'calc(var(--header-pt) + 20px)',
          }}>
          <button onClick={() => setListView(null)} aria-label="К выбору блоков"
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-95 relative before:absolute before:-inset-1.5 before:content-['']"
            style={{ background: 'transparent', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] font-mono font-bold truncate" style={{ color: 'var(--c-text)' }}>
              {theme ? `${theme} · ` : ''}Блок {lb.localId}
              <span style={{ color: 'var(--c-muted)' }}> · {lb.range}</span>
            </div>
            <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
              Вопрос — ответ · {lb.size} тестов
            </div>
          </div>
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)' }}>
            <List className="w-4 h-4" />
          </span>
        </div>

        <div ref={listScrollRef} className="flex-1 overflow-y-auto scroll-container">
          <div className="px-4 pt-3 mx-auto max-w-2xl flex flex-col gap-2.5" style={{ paddingBottom: 'var(--scroll-pb)' }}>
            {lb.questions.map((t: any, idx: number) => {
              const answer = correctAnswerText(t);
              const fav = isFavorite(t);
              return (
                <div key={t.id} id={`test-list-${t.id}`} className="rounded-[13px] p-3.5"
                  style={{
                    background: 'var(--c-card)',
                    border: `1px solid ${listView.focusId === t.id ? 'var(--c-primary-br)' : 'var(--c-border)'}`,
                  }}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 mt-0.5"
                      style={{ background: 'var(--c-chip)', color: 'var(--c-muted)' }}>
                      {lb.start + idx}
                    </span>
                    <div className="flex-1 min-w-0">
                      <RichText
                        text={t.question || ''}
                        relatedTerms={itemRelatedTerms(t)}
                        glossaryTerms={dynamicGlossary}
                        fontSize={14}
                        className="font-semibold [&>p]:indent-0 [&>p]:mt-0"
                      />
                    </div>
                    <button type="button" onClick={() => toggleFavorite(t)}
                      aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
                      className="w-7 h-7 -mt-0.5 flex items-center justify-center rounded-lg flex-shrink-0 transition-all active:scale-90"
                      style={{ background: fav ? 'color-mix(in srgb, var(--c-amber) 18%, transparent)' : 'transparent' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={fav ? 'var(--c-amber)' : 'none'} stroke={fav ? 'var(--c-amber)' : 'var(--c-text-faint)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  </div>
                  <div className="mt-2.5 rounded-[10px] px-3 py-2 flex items-start gap-2"
                    style={answer
                      ? { background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary-br)' }
                      : { background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)' }}>
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: answer ? 'var(--c-primary)' : 'var(--c-text-faint)' }} />
                    <span className="text-[13.5px] leading-snug"
                      style={answer ? { color: 'var(--c-primary)', fontWeight: 600 } : { color: 'var(--c-muted)', fontStyle: 'italic' }}>
                      {answer || 'Ответ не указан в ключе'}
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-col gap-2 mt-2">
              <button type="button" onClick={() => { setListView(null); startBlock(lb, 'tap'); }}
                className="h-[48px] rounded-[13px] font-bold text-[14px] inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: 'var(--c-primary)', color: 'var(--c-bg)', boxShadow: '0 6px 18px var(--c-primary-dim)' }}>
                <Check className="w-[15px] h-[15px]" /> Решать этот блок
              </button>
              {nextBlock && (
                <button type="button" onClick={() => setListView({ block: nextBlock })}
                  className="h-[48px] rounded-[13px] font-semibold text-[14px] inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                  Следующий блок · {nextBlock.range} <ArrowRight className="w-[15px] h-[15px]" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ЭКРАН ВЫБОРА БЛОКА
  // ══════════════════════════════════════════════════════════════════════════
  if (selectedBlock === null) {
    const openMistakes = () => {
      setTestSnapshot(mistakes.slice(0, 100));
      resetTest();
      setStudyMode(false);
      setHintsEnabled(false);
      setForcedStudySession(false);
      setSelectedBlock('mistakes');
      maybeShowOnboarding();
    };

    const openFavorites = () => {
      setTestSnapshot([...favorites]);
      resetTest();
      setStudyMode(false);
      setHintsEnabled(false);
      setForcedStudySession(false);
      setSelectedBlock('favorites');
      maybeShowOnboarding();
    };

    const hasQuickModes = mistakes.length > 0 || processed.length >= 10 || favorites.length > 0;

    const statTiles = [
      { label: 'Пройдено', value: perfectCount + startedCount, total: blocks.length, color: 'var(--c-primary)', Icon: Check },
      { label: 'Идеально', value: perfectCount,                 total: blocks.length, color: 'var(--c-amber)',   Icon: Medal },
      { label: 'Ошибок',   value: mistakes.length,              total: null,          color: 'var(--c-danger)',  Icon: Flame, onClick: mistakes.length > 0 ? openMistakes : undefined },
    ];

    return (
      <div className="flex flex-col h-full overflow-hidden max-w-full" style={{ background: 'var(--c-bg)' }}>
        <Header />

        <ScrollArea className="flex-1 scroll-container">
          <div className="px-4 pt-3 mx-auto max-w-2xl w-full" style={{ paddingBottom: 'var(--scroll-pb)' }}>

            {/* Поиск */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--c-muted)' }} />
              <Input
                placeholder="Поиск по № или тексту…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-10 h-11 border focus-visible:ring-0 focus-visible:ring-offset-0 text-sm rounded-xl"
                style={{ background: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)', caretColor: 'var(--c-primary)' }}
              />
              {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--c-muted)' }}
                        type="button"
                        aria-label="Очистить поиск"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
            </div>

            {microLoading && testsData.length === 0 ? (
              <div className="flex items-center justify-center py-24" style={{ color: 'var(--c-primary)' }}>
                <svg className="animate-spin w-8 h-8" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              </div>
            ) : search ? (
              /* Результаты поиска */
              <div className="space-y-2">
                {searchResults.length > 0 ? searchResults.map(t => (
                  <button key={t.id} onClick={() => startFromQuestion(t.id)}
                    className="w-full p-4 rounded-2xl text-left transition-all active:scale-[0.98] flex gap-3"
                    style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <span className="text-[10px] font-mono font-bold px-2 py-1 rounded h-fit shrink-0"
                      style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)', border: '1px solid var(--c-primary-br)' }}>{t.id}</span>
                    <span className="text-sm line-clamp-2" style={{ color: 'var(--c-text)' }}>{t.question}</span>
                  </button>
                )) : (
                  <p className="text-center py-10 text-sm" style={{ color: 'var(--c-muted)' }}>Ничего не найдено</p>
                )}
              </div>
            ) : (
              <>
                {/* 3 плитки статистики — компактные */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {statTiles.map(s => {
                    const isClickable = !!s.onClick;
                    const isMistakesTile = s.label === 'Ошибок' && mistakes.length > 0;
                    const tileStyle = {
                      background: isMistakesTile ? 'var(--c-danger-soft)' : 'var(--c-card)',
                      border: `1px solid ${isMistakesTile ? 'color-mix(in srgb, var(--c-danger) 35%, transparent)' : 'var(--c-border)'}`,
                    };
                    const inner = (
                      <>
                        <div className="flex items-center gap-1.5">
                          <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center flex-shrink-0"
                            style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)`, color: s.color }}>
                            <s.Icon className="w-3 h-3" />
                          </div>
                          <div className="text-[15px] font-bold leading-none font-mono" style={{ color: 'var(--c-text)', letterSpacing: -0.3 }}>
                            {s.value}{s.total !== null && <span className="text-[10px] font-normal" style={{ color: 'var(--c-text-faint)' }}>/{s.total}</span>}
                          </div>
                        </div>
                        <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: isMistakesTile ? 'var(--c-danger)' : 'var(--c-muted)' }}>
                          {s.label}{isClickable ? ' ↗' : ''}
                        </div>
                      </>
                    );
                    if (isClickable) {
                      return (
                        <button
                          key={s.label}
                          type="button"
                          onClick={s.onClick}
                          className="rounded-[12px] px-2.5 py-2 flex flex-col items-center gap-1 transition-all active:scale-95"
                          style={tileStyle}
                        >
                          {inner}
                        </button>
                      );
                    }
                    return (
                      <div key={s.label} className="rounded-[12px] px-2.5 py-2 flex flex-col items-center gap-1" style={tileStyle}>
                        {inner}
                      </div>
                    );
                  })}
                </div>

                {/* Как открывать блок: решать тест или читать «вопрос — ответ» */}
                <div className="flex p-1 gap-1 rounded-[12px] mb-3"
                  style={{ background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)' }}>
                  {([
                    { mode: 'solve', label: 'Решать тест',    Icon: Check },
                    { mode: 'list',  label: 'Вопрос — ответ', Icon: List },
                  ] as const).map(({ mode, label, Icon }) => {
                    const active = openMode === mode;
                    return (
                      <button key={mode} type="button" onClick={() => changeOpenMode(mode)}
                        className="flex-1 h-9 rounded-[9px] inline-flex items-center justify-center gap-1.5 text-[12px] font-bold transition-all active:scale-[0.98]"
                        style={active
                          ? { background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }
                          : { background: 'transparent', border: '1px solid transparent', color: 'var(--c-muted)' }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: active ? 'var(--c-primary)' : undefined }} />
                        {label}
                      </button>
                    );
                  })}
                </div>

                {openMode === 'list' ? (
                  <p className="text-[11px] leading-snug mb-3 px-1" style={{ color: 'var(--c-muted)' }}>
                    Нажми на блок — откроется список вопросов только с правильными ответами, без неверных вариантов.
                  </p>
                ) : (
                  <BlockOpenHint
                    expanded={studyHintOpen}
                    onToggle={toggleStudyHint}
                    showHintAttention={!studyHintEverOpened && !studyHintOpen}
                  />
                )}

                {/* Заголовок «Блоки» + размер блока + переключатель по темам */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Блоки</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setBlockSizeDraft(''); setBlockSizeOpen(true); }}
                      className="text-[10px] font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1 transition-all active:scale-95"
                      style={{ background: 'var(--c-chip)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      по {testsPerBlock}
                    </button>
                    {hasThemes && (
                      <button
                        onClick={() => { setShowByTheme(v => !v); setExpandedThemes(new Set()); }}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg transition-all active:scale-95"
                        style={showByTheme
                          ? { background: 'var(--c-primary-dim)', color: 'var(--c-primary)', border: '1px solid var(--c-primary-br)' }
                          : { background: 'var(--c-chip)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}
                      >
                        По темам
                      </button>
                    )}
                    <span className="text-[11px] font-mono" style={{ color: 'var(--c-text-faint)' }}>
                      {showByTheme && themeGroups ? `${themeGroups.length} тем` : `${blocks.length} шт`}
                    </span>
                  </div>
                </div>

                {/* Сетка блоков — с группировкой по темам или без */}
                {hasThemes && showByTheme && themeGroups ? themeGroups.map(g => {
                  const isExpanded = expandedThemes.has(g.theme);
                  const themePerfect = g.blocks.filter(b => b.status === 'perfect').length;
                  const themeTotal   = g.blocks.length;
                  return (
                    <div key={g.theme} style={{ marginBottom: 4, maxWidth: 'calc(100vw - 32px)', overflow: 'hidden' }}>
                      <button
                        onClick={() => setExpandedThemes(prev => {
                          const next = new Set(prev);
                          if (next.has(g.theme)) next.delete(g.theme); else next.add(g.theme);
                          return next;
                        })}
                        style={{ width: 'calc(100vw - 32px)', maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px', boxSizing: 'border-box' }}
                        className="active:opacity-70"
                      >
                        <ChevronDown
                          className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                          style={{ color: 'var(--c-muted)', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                        />
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.theme}
                        </span>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', flexShrink: 0, marginLeft: 4, color: themePerfect === themeTotal && themeTotal > 0 ? 'var(--c-primary)' : 'var(--c-text-faint)' }}>
                          {themePerfect}/{themeTotal}
                        </span>
                      </button>
                      {isExpanded && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                          {g.blocks.map(b => (
                            <div key={b.id} style={{ width: 'calc((100vw - 56px) / 4)' }}>
                              <BlockButton b={b} onSelect={() => openBlock(b, 'tap')} onStudySelect={() => openBlock(b, 'study')} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  <div className="grid grid-cols-4 gap-2">
                    {blocks.map((b, i) => (
                      <BlockButton
                        key={b.id}
                        b={{ ...b, localId: i + 1, range: `${i * TESTS_PER_BLOCK + 1}–${Math.min((i + 1) * TESTS_PER_BLOCK, TOTAL_TESTS)}` }}
                        onSelect={() => openBlock(b, 'tap')}
                        onStudySelect={() => openBlock(b, 'study')}
                      />
                    ))}
                  </div>
                )}

                {/* Компактные режимы — под блоками */}
                {hasQuickModes && (
                  <div className="mt-4 flex flex-col gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: 'var(--c-muted)' }}>
                      Дополнительно
                    </span>
                    {mistakes.length > 0 && (
                      <QuickModeButton
                        onClick={openMistakes}
                        Icon={Flame}
                        title="Работа над ошибками"
                        subtitle="Повторите вопросы, на которых ошиблись"
                        badge={`${Math.min(mistakes.length, 100)}/100`}
                        color="var(--c-danger)"
                      />
                    )}
                    {processed.length >= 10 && (
                      <QuickModeButton
                        onClick={startExam}
                        Icon={Award}
                        title="Экзамен"
                        subtitle="100 случайных вопросов из всей базы"
                        badge="100"
                        color="var(--c-primary)"
                      />
                    )}
                    {favorites.length > 0 && (
                      <QuickModeButton
                        onClick={openFavorites}
                        Icon={Zap}
                        title="Избранное"
                        subtitle="Вопросы, которые вы отметили"
                        badge={String(favorites.length)}
                        color="var(--c-amber)"
                      />
                    )}
                  </div>
                )}

                {/* Выбор размера блока */}
                <Dialog open={blockSizeOpen} onOpenChange={setBlockSizeOpen}>
                  <DialogContent className="max-w-sm w-[92vw] rounded-3xl p-6" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <DialogHeader>
                      <DialogTitle className="text-[15px] font-bold leading-snug flex items-center gap-2" style={{ color: 'var(--c-text)' }}>
                        <SlidersHorizontal className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-primary)' }} />
                        По сколько тестов в блоке
                      </DialogTitle>
                    </DialogHeader>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {TESTS_PER_BLOCK_PRESETS.map(n => {
                        const active = n === testsPerBlock;
                        return (
                          <button key={n} type="button" onClick={() => applyBlockSize(n)}
                            className="h-11 rounded-[11px] text-[14px] font-mono font-bold transition-all active:scale-95"
                            style={active
                              ? { background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary-br)', color: 'var(--c-primary)' }
                              : { background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                    <form className="mt-3 flex gap-2"
                      onSubmit={e => { e.preventDefault(); if (blockSizeDraft) applyBlockSize(Number(blockSizeDraft)); }}>
                      <Input
                        inputMode="numeric"
                        placeholder={`Своё число: ${MIN_TESTS_PER_BLOCK}–${MAX_TESTS_PER_BLOCK}`}
                        value={blockSizeDraft}
                        onChange={e => setBlockSizeDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        className="h-11 flex-1 border focus-visible:ring-0 focus-visible:ring-offset-0 text-sm rounded-[11px]"
                        style={{ background: 'var(--c-bg-subtle)', borderColor: 'var(--c-border)', color: 'var(--c-text)', caretColor: 'var(--c-primary)' }}
                      />
                      <button type="submit" disabled={!blockSizeDraft}
                        className="h-11 px-4 rounded-[11px] font-bold text-[13px] transition-all active:scale-95 disabled:opacity-40"
                        style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}>
                        OK
                      </button>
                    </form>
                    {(() => {
                      const size = blockSizeDraft ? clampTestsPerBlock(blockSizeDraft) : testsPerBlock;
                      return (
                        <p className="mt-3 text-[11.5px] leading-snug" style={{ color: 'var(--c-muted)' }}>
                          {TOTAL_TESTS > 0 && <>{TOTAL_TESTS} тестов → {Math.ceil(TOTAL_TESTS / size)} блоков по {size}. </>}
                          Лучшие результаты сохраняются отдельно для каждого размера — вернёшься к прежнему, и они снова будут на месте.
                        </p>
                      );
                    })()}
                  </DialogContent>
                </Dialog>

                {/* Заметки — внизу, не перекрывают блоки */}
                <Dialog>
                  <DialogTrigger asChild>
                    <button className="w-full mt-4 rounded-[12px] px-3.5 py-2.5 flex items-center gap-2.5 text-left transition-all active:scale-[0.99]"
                      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                      <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--c-amber-soft)', color: 'var(--c-amber)' }}>
                        <FileText className="w-[14px] h-[14px]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-bold" style={{ color: 'var(--c-text)' }}>Мои заметки</div>
                        <div className="text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--c-muted)' }}>
                          {testsNote ? testsNote.replace(/\s+/g, ' ').slice(0, 48) + (testsNote.length > 48 ? '…' : '') : 'Личные записи по тестам'}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--c-text-faint)' }} />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg w-[95vw] rounded-3xl p-6" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-sm uppercase tracking-wider" style={{ color: 'var(--c-amber)' }}>
                        <Pencil className="w-4 h-4" /> Мои заметки
                      </DialogTitle>
                    </DialogHeader>
                    <div className="mt-4 p-4 rounded-2xl" style={{ background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-br)' }}>
                      <div className="flex justify-between mb-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-amber)' }}>Текст</span>
                        <div className="flex gap-3">
                          {testsNote && (
                            <button onClick={() => { setTestsNote(''); setLocalTestsNote(''); localStorage.removeItem(lsNote); }}
                              style={{ color: 'var(--c-danger)' }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => { if (isEditingNote) saveNote(localTestsNote); setIsNoteEditing(v => !v); }}
                            className="text-xs font-semibold" style={{ color: 'var(--c-amber)' }}>
                            {isEditingNote ? 'Готово' : 'Править'}
                          </button>
                        </div>
                      </div>
                      {isEditingNote
                        ? <textarea ref={noteRef} value={localTestsNote} onChange={e => setLocalTestsNote(e.target.value)} onBlur={() => saveNote(localTestsNote)}
                            className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm resize-none min-h-[150px]"
                            style={{ color: 'var(--c-text)', caretColor: 'var(--c-amber)' }} autoFocus />
                        : <div className="text-sm prose prose-invert max-w-none break-words whitespace-pre-wrap min-h-[100px]" onClick={() => setIsNoteEditing(true)}>
                            {testsNote
                              ? <ReactMarkdown>{testsNote}</ReactMarkdown>
                              : <p className="italic" style={{ color: 'color-mix(in srgb, var(--c-amber) 35%, transparent)' }}>Нажмите «Править»…</p>}
                          </div>}
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ЭКРАН РЕЗУЛЬТАТОВ
  // ══════════════════════════════════════════════════════════════════════════
  if (completed) {
    const total = blockTests.length;
    const isMistakeMode = selectedBlock === 'mistakes';
    const isExamMode = selectedBlock === 'exam';
    const isFavoritesMode = selectedBlock === 'favorites';
    const pct = total ? Math.round((score / total) * 100) : 0;
    const isPerfect = score === total && total > 0;
    const isOk = score >= Math.ceil(total * 0.85);
    const color = isPerfect ? 'var(--c-amber)' : isOk ? 'var(--c-primary)' : 'var(--c-danger)';
    const wrong = total - score;

    const ringSize = 150, ringStroke = 13;
    const r = (ringSize - ringStroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);

    const cards: { lbl: string; v: React.ReactNode; color: string; Icon: React.ComponentType<{ className?: string }> }[] = [
      { lbl: 'Верно',  v: score, color: 'var(--c-primary)', Icon: CheckCircle2 },
      { lbl: 'Ошибок', v: wrong, color: 'var(--c-danger)',  Icon: XCircle },
    ];
    if (!isMistakeMode && !isExamMode && !isFavoritesMode && !studyMode) {
      cards.push({ lbl: 'Лучший', v: `${Math.max(prevBest, score)}/${total}`, color: 'var(--c-amber)', Icon: Medal });
    }

    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--c-bg)' }}>
        <div className="flex-1 overflow-y-auto scroll-container flex flex-col items-center text-center px-6"
          style={{ paddingTop: 'calc(var(--header-pt) + 8px)', paddingBottom: 'var(--scroll-pb)' }}>

          {/* Кольцо */}
          <div className="relative mt-2" style={{ width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke="var(--c-border)" strokeWidth={ringStroke} fill="none" />
              <circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={color} strokeWidth={ringStroke} fill="none"
                strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.9s ease' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
              <div className="font-bold leading-none" style={{ fontSize: 38, color: 'var(--c-text)', letterSpacing: -1.5 }}>
                {score}<span style={{ fontSize: 18, color: 'var(--c-text-faint)', fontWeight: 500 }}>/{total}</span>
              </div>
              <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color }}>{pct}%</div>
            </div>
          </div>

          {/* Заголовок */}
          <h2 className="mt-5 text-[22px] font-bold leading-tight" style={{ color: 'var(--c-text)', letterSpacing: -0.5 }}>
            {isPerfect
              ? (isExamMode ? 'Экзамен сдан на отлично!' : isMistakeMode ? 'Все ошибки исправлены!' : 'Идеально!')
              : isOk ? (isExamMode ? 'Хороший результат на экзамене' : 'Отличный результат') : 'Можно лучше'}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-snug" style={{ color: 'var(--c-muted)', maxWidth: 300 }}>
            {studyMode && isRegularBlock(selectedBlock)
              ? 'Учебный проход — лучший счёт не обновляется'
              : isPerfect ? 'Знания крепкие, как здоровая эмаль'
              : isOk ? 'Несколько ошибок — посмотри их в «Работе над ошибками»'
              : 'Стоит повторить теорию по этому блоку'}
          </p>

          {/* Мини-карточки */}
          <div className="grid gap-2 mt-5 w-full max-w-sm" style={{ gridTemplateColumns: `repeat(${cards.length}, 1fr)` }}>
            {cards.map(m => (
              <div key={m.lbl} className="rounded-[13px] py-3 px-2 flex flex-col items-center gap-1.5"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center"
                  style={{ background: `color-mix(in srgb, ${m.color} 16%, transparent)`, color: m.color }}>
                  <m.Icon className="w-[13px] h-[13px]" />
                </div>
                <div className="font-bold leading-none" style={{ fontSize: typeof m.v === 'number' ? 20 : 14, color: 'var(--c-text)', letterSpacing: -0.3 }}>
                  {m.v}
                </div>
                <div className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>{m.lbl}</div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="flex flex-col gap-2.5 w-full max-w-sm mt-6">
            <button onClick={() => {
              resetTest();
              setForcedStudySession(false);
              if (isRegularBlock(selectedBlock)) {
                const firstPass = (blockAttempts[selectedBlock] || 0) === 0;
                setStudyMode(firstPass);
                setAutoNext(firstPass);
              }
            }}
              className="h-[52px] rounded-[13px] font-bold text-[14px] inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ background: 'var(--c-primary)', color: 'var(--c-bg)', boxShadow: '0 6px 18px var(--c-primary-dim)' }}>
              <RotateCcw className="w-[15px] h-[15px]" /> Пройти ещё раз
            </button>
            <button onClick={() => { resetTest(); setSelectedBlock(null); }}
              className="h-[52px] rounded-[13px] font-semibold text-[14px] inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
              <ArrowLeft className="w-[15px] h-[15px]" /> К выбору блоков
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ЭКРАН ТЕСТА
  // ══════════════════════════════════════════════════════════════════════════
  const isMistakeMode = selectedBlock === 'mistakes';
  const isExamModeTest = selectedBlock === 'exam';
  const isFavoritesModeTest = selectedBlock === 'favorites';
  const isBlockMode = isRegularBlock(selectedBlock);
  const visibleOptions = options.filter((opt: string) => !hidden5050.includes(opt));
  const answerRevealed = studyMode;
  const hintsAvailable = isBlockMode && hintsEnabled && !studyMode && !showResult;
  const scoredCurrent = scoredAnswers[currentTestIndex];
  const resolvedCorrect = currentTest ? resolveCorrectOption(currentTest) : '';

  return (
    <div className="flex flex-col h-full overflow-hidden max-w-full" style={{ background: 'var(--c-bg)' }}>

      {/* Онбординг при первом входе в режим теста */}
      <Dialog open={showOnboarding} onOpenChange={open => { if (!open) dismissOnboarding(); }}>
        <DialogContent className="max-w-md w-[92vw] rounded-3xl p-6" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold leading-snug flex items-start gap-1.5" style={{ color: 'var(--c-text)' }}>
              <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--c-amber)' }} />
              <span>{STUDY_HINT_TITLE}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-4">
            <BlockOpenHint variant="dialog" />
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--c-muted)' }}>
              <strong style={{ color: 'var(--c-text)' }}>«Обучение» и «Подсказка»</strong> — в нижней панели во время теста. Кнопка 50/50 появляется, если «Подсказка» включена, а «Обучение» выключено.
            </p>
          </div>
          <label className="flex items-center gap-2.5 mt-4 cursor-pointer">
            <Checkbox
              checked={onboardingDismiss}
              onCheckedChange={v => setOnboardingDismiss(v === true)}
              className="border-[var(--c-border)] data-[state=checked]:bg-[var(--c-primary)]"
            />
            <span className="text-[12.5px]" style={{ color: 'var(--c-muted)' }}>Больше не показывать</span>
          </label>
          <button
            onClick={dismissOnboarding}
            className="w-full h-11 rounded-[12px] font-bold text-[13.5px] mt-4 transition-all active:scale-[0.98]"
            style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
          >
            Понятно
          </button>
        </DialogContent>
      </Dialog>

      {/* Compact top */}
      <div className="px-3.5 py-2.5 sticky top-0 z-20 flex items-center gap-2.5"
        style={{
          background: 'color-mix(in srgb, var(--c-bg) 95%, transparent)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--c-border)',
          paddingTop: 'calc(var(--header-pt) + 20px)',
        }}>
        <button onClick={() => { setTestSettingsOpen(false); resetTest(); setSelectedBlock(null); }}
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-95 relative before:absolute before:-inset-1.5 before:content-['']"
          style={{ background: 'transparent', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11.5px] font-mono font-bold flex items-center gap-1.5"
              style={{ color: selectedBlock === 'mistakes' ? 'var(--c-danger)' : selectedBlock === 'exam' ? 'var(--c-primary)' : selectedBlock === 'favorites' ? 'var(--c-amber)' : 'var(--c-text)' }}>
              {isMistakeMode && <AlertTriangle className="w-3 h-3" />}
              {selectedBlock === 'mistakes' ? 'Ошибки' : selectedBlock === 'exam' ? 'Экзамен' : selectedBlock === 'favorites' ? 'Избранное' : `Блок ${selectedBlock}`}
              <span style={{ color: 'var(--c-muted)' }}>{currentTestIndex + 1}/{blockTests.length}</span>
              {studyMode && isBlockMode && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md"
                  style={{ background: 'color-mix(in srgb, var(--c-amber) 18%, transparent)', color: 'var(--c-amber)' }}>
                  Обучение
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)' }}>
                <Check className="w-2.5 h-2.5" /> {score}
              </span>
              <button
                onClick={() => currentTest && toggleFavorite(currentTest)}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90 relative before:absolute before:-inset-2 before:content-['']"
                style={{ background: isFavorite(currentTest) ? 'color-mix(in srgb, var(--c-amber) 18%, transparent)' : 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite(currentTest) ? 'var(--c-amber)' : 'none'} stroke={isFavorite(currentTest) ? 'var(--c-amber)' : 'var(--c-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            </div>
          </div>
          <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--c-bg-subtle)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${((currentTestIndex + 1) / blockTests.length) * 100}%`,
                background: selectedBlock === 'mistakes' ? 'var(--c-danger)' : 'var(--c-primary)',
              }} />
          </div>
        </div>
      </div>

      <div ref={testScrollRef} className="flex-1 overflow-y-auto scroll-container">
        <div className="px-4 pt-3 pb-28 mx-auto max-w-2xl flex flex-col gap-3.5">

          {/* Вопрос (номер — в шапке) */}
          <div>
            <RichText
              text={currentTest?.question || ''}
              relatedTerms={itemRelatedTerms(currentTest)}
              glossaryTerms={dynamicGlossary}
              fontSize={16}
              className="font-semibold"
            />
          </div>

          {/* Подсказка 50/50 */}
          {hintsAvailable && (
            <button
              onClick={use5050Hint}
              disabled={hintLevel >= 1}
              className="w-full h-10 rounded-[11px] inline-flex items-center justify-center gap-1.5 text-[11.5px] font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{
                background: hintLevel >= 1 ? 'var(--c-primary-dim)' : 'var(--c-card)',
                border: `1px solid ${hintLevel >= 1 ? 'var(--c-primary-br)' : 'var(--c-border)'}`,
                color: hintLevel >= 1 ? 'var(--c-primary)' : 'var(--c-muted)',
              }}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              50/50 — убрать 2 неверных
            </button>
          )}

          {/* Варианты */}
          <div className="flex flex-col gap-2">
            {visibleOptions.map((opt: string, idx: number) => {
              const correct        = isCorrectTestOption(opt, currentTest.correct);
              const selected       = selectedOption === opt;
              const questionLocked = scoredAnswers[currentTestIndex] !== undefined;
              const isWrong        = showResult && questionLocked && selected && !correct;
              const selectedRight  = showResult && questionLocked && selected && correct;
              const revealCorrect  = (showResult && questionLocked && correct && !selected) || (answerRevealed && correct && !showResult);
              const dimmed         = showResult && questionLocked && !correct && !selected && !revealCorrect;
              return (
                <button key={opt} onClick={() => handleSelect(opt)} disabled={showResult}
                  className="w-full rounded-[13px] p-3.5 flex items-center gap-3 text-left transition-all active:scale-[0.99]"
                  style={{
                    background: selectedRight || revealCorrect ? 'var(--c-primary-dim)' : isWrong ? 'var(--c-danger-soft)' : 'var(--c-card)',
                    border: `1.5px solid ${selectedRight || revealCorrect ? 'var(--c-primary-br)' : isWrong ? 'color-mix(in srgb, var(--c-danger) 45%, transparent)' : 'var(--c-border)'}`,
                    opacity: dimmed ? 0.55 : 1,
                  }}>
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[12px] font-mono font-bold"
                    style={{
                      background: selectedRight ? 'var(--c-primary)' : isWrong ? 'var(--c-danger)' : 'var(--c-chip)',
                      color: (selectedRight || isWrong) ? 'var(--c-bg)' : 'var(--c-muted)',
                    }}>
                    {LETTERS[idx] || idx + 1}
                  </span>
                  <span className="flex-1 text-[14px] leading-snug"
                    style={{ color: selectedRight ? 'var(--c-primary)' : isWrong ? 'var(--c-danger)' : revealCorrect ? 'var(--c-primary)' : 'var(--c-text)', fontWeight: (selectedRight || revealCorrect) ? 600 : 500 }}>
                    {opt}
                  </span>
                  {selectedRight  && <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-primary)' }} />}
                  {revealCorrect && !showResult && <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-primary)' }} />}
                  {isWrong        && <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-danger)' }} />}
                </button>
              );
            })}
          </div>

          {showResult && scoredCurrent && currentTest && (
            <div
              className="rounded-[13px] px-3.5 py-3 flex items-start gap-2.5"
              style={{
                background: scoredCurrent.correct ? 'var(--c-primary-dim)' : 'var(--c-danger-soft)',
                border: `1px solid ${scoredCurrent.correct ? 'var(--c-primary-br)' : 'color-mix(in srgb, var(--c-danger) 40%, transparent)'}`,
              }}
            >
              {scoredCurrent.correct
                ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--c-primary)' }} />
                : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--c-danger)' }} />}
              <div className="min-w-0 text-[13px] leading-snug">
                {scoredCurrent.correct ? (
                  <span style={{ color: 'var(--c-primary)', fontWeight: 600 }}>Верно</span>
                ) : (
                  <>
                    <span style={{ color: 'var(--c-danger)', fontWeight: 600 }}>Неверно.</span>
                    {' '}
                    <span style={{ color: 'var(--c-text)' }}>
                      Правильный ответ: <span style={{ fontWeight: 600 }}>{resolvedCorrect}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Навигация: предыдущий / следующий */}
          {(showResult || currentTestIndex > 0) && (
            <div
              className="flex p-1 gap-1 rounded-full"
              style={{ background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)' }}
            >
              <button
                type="button"
                onClick={prevQuestion}
                disabled={currentTestIndex === 0}
                className="flex-1 h-11 rounded-full inline-flex items-center justify-center gap-1.5 text-[13px] font-bold transition-all active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: currentTestIndex === 0 ? 'transparent' : 'var(--c-card)',
                  color: 'var(--c-muted)',
                  border: currentTestIndex === 0 ? 'none' : '1px solid var(--c-border)',
                }}
              >
                <ArrowLeft className="w-4 h-4" />
                Предыдущий
              </button>
              <button
                type="button"
                onClick={nextQuestion}
                disabled={!showResult}
                className="flex-1 h-11 rounded-full inline-flex items-center justify-center gap-1.5 text-[13px] font-bold transition-all active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: showResult ? 'var(--c-primary)' : 'var(--c-card)',
                  color: showResult ? 'var(--c-bg)' : 'var(--c-muted)',
                  boxShadow: showResult ? '0 4px 14px var(--c-primary-dim)' : 'none',
                }}
              >
                {currentTestIndex === blockTests.length - 1 ? 'Результаты' : 'Следующий'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Настройки теста (оверлей) */}
      {testSettingsOpen && (
        <button
          type="button"
          aria-label="Закрыть настройки"
          className="fixed inset-0 z-30 border-0 p-0 cursor-default"
          style={{ background: 'color-mix(in srgb, var(--c-bg) 55%, transparent)' }}
          onClick={() => setTestSettingsOpen(false)}
        />
      )}

      {/* Нижняя панель: настройки / выход */}
      <div className="flex-shrink-0 z-40 relative px-4"
        style={{
          background: 'var(--c-card)', borderTop: '1px solid var(--c-border)',
          paddingTop: testSettingsOpen ? 12 : 10,
          paddingBottom: 'calc(var(--nav-bottom, 12px) + 12px)',
        }}>
        {testSettingsOpen && (
          <div className="mb-2.5 grid gap-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {([
              ...(isBlockMode && !forcedStudySession
                ? [
                    { on: studyMode,    label: 'Обучение',  Icon: BookOpen,  toggle: toggleStudyMode,    disabled: showResult },
                    { on: hintsEnabled, label: 'Подсказка', Icon: Lightbulb, toggle: toggleHintsEnabled, disabled: showResult || studyMode },
                  ]
                : []),
              { on: autoNext,       label: 'Авто',       Icon: Zap,     toggle: () => setAutoNext(v => !v),                            disabled: false },
              { on: shuffleOptions, label: 'Перемешать', Icon: Shuffle, toggle: () => { if (!showResult) setShuffleOptions(v => !v); }, disabled: showResult },
            ] as const).map(t => (
              <button key={t.label} type="button" onClick={t.toggle} disabled={t.disabled}
                className="h-10 rounded-[11px] inline-flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40"
                style={t.on
                  ? { background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary-br)', color: 'var(--c-primary)' }
                  : { background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                <t.Icon className="w-3.5 h-3.5" />
                {t.label}
                <span className="text-[8.5px] font-mono font-bold px-1 py-0.5 rounded"
                  style={t.on
                    ? { background: 'color-mix(in srgb, var(--c-primary) 25%, transparent)', color: 'var(--c-primary)' }
                    : { background: 'var(--c-chip)', color: 'var(--c-text-faint)' }}>
                  {t.on ? 'ВКЛ' : 'ВЫК'}
                </span>
              </button>
            ))}
          </div>
        )}

        {(() => {
          const anySettingOn = autoNext || shuffleOptions || (isBlockMode && !forcedStudySession && (studyMode || hintsEnabled));
          return (
            <div
              className="flex p-1 gap-1 rounded-full"
              style={{ background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)' }}
            >
              <button
                type="button"
                onClick={() => setTestSettingsOpen(v => !v)}
                className="flex-1 h-11 rounded-full inline-flex items-center justify-center gap-1.5 text-[12.5px] font-bold transition-all active:scale-[0.98] relative"
                style={{
                  background: testSettingsOpen ? 'var(--c-primary-dim)' : 'var(--c-card)',
                  color: testSettingsOpen ? 'var(--c-primary)' : 'var(--c-muted)',
                  border: testSettingsOpen ? '1px solid var(--c-primary-br)' : '1px solid var(--c-border)',
                }}
              >
                <Settings2 className="w-4 h-4" />
                Настройки
                {anySettingOn && !testSettingsOpen && (
                  <span className="absolute top-2 right-3 w-2 h-2 rounded-full" style={{ background: 'var(--c-primary)' }} />
                )}
              </button>
              <button
                type="button"
                onClick={() => { setTestSettingsOpen(false); resetTest(); setSelectedBlock(null); }}
                className="flex-1 h-11 rounded-full inline-flex items-center justify-center gap-1.5 text-[12.5px] font-bold transition-all active:scale-[0.98]"
                style={{
                  background: 'color-mix(in srgb, var(--c-danger) 12%, var(--c-card))',
                  color: 'var(--c-danger)',
                  border: '1px solid color-mix(in srgb, var(--c-danger) 28%, transparent)',
                }}
              >
                <LogOut className="w-4 h-4" />
                Выйти
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
