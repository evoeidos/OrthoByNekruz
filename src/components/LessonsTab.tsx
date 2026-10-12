"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Circle, Clock, FileText, GraduationCap, HelpCircle, Info, Languages, Lightbulb, ListChecks,
  Target, X,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  AnnotationBlock, Lecture, Lesson, LessonKind, LessonSection, LessonTest,
} from '@/lib/curriculum';
import { ReadingImages, useImageZoom } from '@/components/ImageZoom';
import { TermAtlas } from '@/components/TermAtlas';
import { getSubject } from '@/lib/subjects';
import { UniLibraryTab } from '@/components/UniLibraryTab';
import { EMPTY_UNI } from '@/lib/uniHelpers';
import { postUniData } from '@/lib/uniCache';

/** Особый пункт ленты: дисциплины студента с сайта КрасГМУ (после привязки аккаунта). */
const KRASGMU_CHIP = '__krasgmu__';

// Локальная копия подписей: импорт значения из curriculum притащил бы в
// клиентский бандл все планы кафедр из файлов.
const KIND_LABELS: Record<LessonKind, string> = {
  lesson: 'Занятие',
  control: 'Контрольная',
  colloquium: 'Коллоквиум',
};

const CONTROL_COLOR = '#B4801F';

/** Отступ сверху под кнопки Telegram — как у шапок остальных вкладок. */
const TOP_PAD = 'max(12px, calc(var(--header-pt) - 24px))';

/** Предмет, по которому у студента есть занятия (для переключателя). */
interface LessonSubjectOption {
  id: string;
  label: string;
  color: string;
}

interface StudentProgram {
  id: string;
  subjectId: string;
  subjectLabel: string;
  subjectColor: string;
  title: string;
  sourceDoc: string | null;
  course: number;
  lessons: Lesson[];
  lectures: Lecture[];
}

/** Занятие вместе с курсом и семестром, из которого оно пришло. */
/** Тяжёлая часть занятия, которая приходит отдельным запросом. */
interface LessonContent {
  annotation?: AnnotationBlock[];
  images?: string[];
  questions?: string[];
  tests?: LessonTest[];
}

interface FlatLesson {
  lesson: Lesson;
  programId: string;
  course: number;
  semester?: number;
}

interface SubjectView {
  subjectId: string;
  label: string;
  color: string;
  sourceDoc: string | null;
  items: FlatLesson[];
  lectures: Lecture[];
}

function doneStorageKey(subjectId: string): string {
  return `lessons_done:${subjectId}`;
}

function readDone(subjectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(doneStorageKey(subjectId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Программы одного предмета склеиваются в непрерывный план по всем курсам. */
function buildSubjectViews(programs: StudentProgram[]): SubjectView[] {
  const bySubject = new Map<string, StudentProgram[]>();
  for (const p of programs) {
    const list = bySubject.get(p.subjectId) ?? [];
    list.push(p);
    bySubject.set(p.subjectId, list);
  }

  return [...bySubject.entries()].map(([subjectId, list]) => {
    const sorted = [...list].sort((a, b) => a.course - b.course);
    const items: FlatLesson[] = [];
    const lectures: Lecture[] = [];

    for (const p of sorted) {
      for (const lesson of p.lessons) {
        items.push({ lesson, programId: p.id, course: p.course, semester: lesson.semester });
      }
      lectures.push(...p.lectures);
    }

    items.sort((a, b) => {
      if (a.course !== b.course) return a.course - b.course;
      const an = a.lesson.planNumber ?? a.lesson.order;
      const bn = b.lesson.planNumber ?? b.lesson.order;
      return an - bn;
    });

    return {
      subjectId,
      label: sorted[0].subjectLabel,
      color: sorted[0].subjectColor,
      sourceDoc: sorted[0].sourceDoc,
      items,
      lectures,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function sectionTitle(item: FlatLesson): string {
  return item.semester
    ? `${item.course} курс · ${item.semester} семестр`
    : `${item.course} курс`;
}

export const LessonsTab = ({ subject, onOpenProfile }: {
  /** Предмет, выбранный в приложении: показываем только его план */
  subject: string;
  onOpenProfile?: () => void;
}) => {
  const [programs, setPrograms] = useState<StudentProgram[]>([]);
  const [studyGroup, setStudyGroup] = useState<string | null>(null);
  // Занятия бесплатны по всем предметам курса — во вкладке можно переключиться
  // с предмета, выбранного в приложении, на любой другой из этого списка.
  const [lessonSubject, setLessonSubject] = useState(subject);
  const [lessonSubjects, setLessonSubjects] = useState<LessonSubjectOption[]>([]);
  // Привязан ли аккаунт КрасГМУ: тогда во вкладке есть настоящие дисциплины
  // студента с сайта университета — для любого факультета, без ручных планов.
  const [uniStatus, setUniStatus] = useState<'checking' | 'bound' | 'unbound'>('checking');
  const [showKrasgmu, setShowKrasgmu] = useState(false);
  const autoKrasgmuFor = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [contents, setContents] = useState<Record<string, LessonContent | 'loading' | 'failed'>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setPrograms([]);
    setFailed(false);
    try {
      const tgId = localStorage.getItem('user_tg_id') || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initData = (window as any).Telegram?.WebApp?.initData || '';
      const r = await fetch('/api/curriculum', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, initData, subjectId: lessonSubject }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error || 'Ошибка'));
      setStudyGroup(d.studyGroup ?? null);
      setPrograms((d.programs as StudentProgram[]) ?? []);
      setLessonSubjects((d.lessonSubjects as LessonSubjectOption[]) ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [lessonSubject]);

  useEffect(() => {
    setLessonSubject(subject);
    setShowKrasgmu(false);
    autoKrasgmuFor.current = null;
  }, [subject]);

  useEffect(() => {
    let cancelled = false;
    postUniData({ action: 'status' })
      .then(({ ok, data }) => { if (!cancelled) setUniStatus(ok && data.bound ? 'bound' : 'unbound'); })
      .catch(() => { if (!cancelled) setUniStatus('unbound'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { void load(); }, [load]);

  const subjects = useMemo(() => buildSubjectViews(programs), [programs]);

  const view = useMemo(
    () => subjects.find(s => s.subjectId === lessonSubject) ?? null,
    [subjects, lessonSubject],
  );

  // Плана кафедры по предмету нет (или не указана группа), а КрасГМУ привязан —
  // сразу показываем дисциплины с сайта университета. Один раз на предмет,
  // дальше студент переключает сам.
  useEffect(() => {
    if (loading || uniStatus !== 'bound' || autoKrasgmuFor.current === lessonSubject) return;
    autoKrasgmuFor.current = lessonSubject;
    if (!studyGroup || !view) setShowKrasgmu(true);
  }, [loading, uniStatus, studyGroup, view, lessonSubject]);

  const chipOptions = useMemo<LessonSubjectOption[]>(
    () => [{ id: KRASGMU_CHIP, label: '🎓 Мои дисциплины', color: 'var(--c-primary)' }, ...lessonSubjects],
    [lessonSubjects],
  );
  const selectChip = useCallback((id: string) => {
    if (id === KRASGMU_CHIP) {
      setShowKrasgmu(true);
      return;
    }
    setShowKrasgmu(false);
    setLessonSubject(id);
  }, []);
  const switcher = (
    <SubjectSwitcher
      options={chipOptions}
      active={showKrasgmu ? KRASGMU_CHIP : lessonSubject}
      onSelect={selectChip}
    />
  );

  useEffect(() => {
    setDone(view ? readDone(view.subjectId) : new Set());
    setReadingId(null);
  }, [view]);

  const toggleDone = useCallback((lessonId: string) => {
    if (!view) return;
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      try {
        localStorage.setItem(doneStorageKey(view.subjectId), JSON.stringify([...next]));
      } catch { /* приватный режим — прогресс просто не сохранится */ }
      return next;
    });
  }, [view]);

  const readingIndex = view ? view.items.findIndex(i => i.lesson.id === readingId) : -1;
  const readingBase = readingIndex >= 0 && view ? view.items[readingIndex] : null;
  const readingKey = readingBase ? `${readingBase.programId}/${readingBase.lesson.id}` : null;
  const readingContent = readingKey ? contents[readingKey] : undefined;

  const loadContent = useCallback(async (programId: string, lessonId: string) => {
    const key = `${programId}/${lessonId}`;
    setContents(prev => ({ ...prev, [key]: 'loading' }));
    try {
      const tgId = localStorage.getItem('user_tg_id') || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initData = (window as any).Telegram?.WebApp?.initData || '';
      const r = await fetch('/api/curriculum', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, initData, subjectId: lessonSubject, programId, lessonId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error || 'Ошибка'));
      setContents(prev => ({ ...prev, [key]: (d.content ?? {}) as LessonContent }));
    } catch {
      setContents(prev => ({ ...prev, [key]: 'failed' }));
    }
  }, [lessonSubject]);

  useEffect(() => {
    if (!readingBase?.lesson.hasContent || !readingKey) return;
    if (contents[readingKey] === undefined) void loadContent(readingBase.programId, readingBase.lesson.id);
  }, [readingBase, readingKey, contents, loadContent]);

  // Текст занятия подмешивается к облегчённому уроку из списка
  const reading = useMemo<FlatLesson | null>(() => {
    if (!readingBase) return null;
    if (readingContent && typeof readingContent === 'object') {
      return { ...readingBase, lesson: { ...readingBase.lesson, ...readingContent } };
    }
    return readingBase;
  }, [readingBase, readingContent]);
  const readingContentState: 'ready' | 'loading' | 'failed' | 'none' =
    !readingBase?.lesson.hasContent ? 'none'
      : readingContent === 'failed' ? 'failed'
        : readingContent && readingContent !== 'loading' ? 'ready' : 'loading';

  const step = useCallback((delta: number) => {
    if (!view || readingIndex < 0) return;
    const n = view.items.length;
    const next = view.items[(readingIndex + delta + n) % n];
    setReadingId(next.lesson.id);
  }, [view, readingIndex]);

  if (showKrasgmu) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 space-y-3"
          style={{ paddingTop: TOP_PAD, paddingBottom: 'var(--scroll-pb, 96px)' }}
        >
          <div className="flex items-center gap-2 px-1">
            <span className="flex-1 text-[20px] font-bold leading-tight" style={{ color: 'var(--c-text)' }}>
              Занятия
            </span>
            {switcher}
          </div>
          <div className="text-[12px] leading-snug px-1" style={{ color: 'var(--c-muted)' }}>
            Твои дисциплины с сайта КрасГМУ: темы занятий и методички к ним.
          </div>
          <UniLibraryTab
            uni={{ ...EMPTY_UNI, checking: uniStatus === 'checking', bound: uniStatus === 'bound' }}
            onBind={onOpenProfile ?? (() => {})}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <EmptyState
        title="Загружаем расписание"
        text="Секунду — смотрим, какие занятия у твоей группы."
      />
    );
  }

  if (failed) {
    return (
      <EmptyState
        title="Не удалось загрузить занятия"
        text="Проверь связь и попробуй ещё раз."
        action={{ label: 'Повторить', onClick: () => void load() }}
      />
    );
  }

  if (!studyGroup) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <EmptyState
            switcher={switcher}
            title="Сначала укажи группу"
            text="Планы кафедр приходят для конкретной группы. А свои дисциплины с сайта университета можно открыть в «🎓 Мои дисциплины» — после привязки аккаунта КрасГМУ."
            action={onOpenProfile ? { label: 'В профиль', onClick: onOpenProfile } : undefined}
          />
        </div>
      </div>
    );
  }

  if (!view) {
    const subjectLabel = getSubject(lessonSubject)?.label;
    const others = lessonSubjects.filter(o => o.id !== lessonSubject);
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          {subjectLabel ? (
            <EmptyState
              switcher={switcher}
              title={`Занятия по предмету «${subjectLabel}» готовятся`}
              text={others.length > 0
                ? 'План кафедры по этому предмету ещё не добавлен. Пока можно открыть «🎓 Мои дисциплины» с сайта КрасГМУ или другой предмет курса — кнопка выше.'
                : 'План кафедры по этому предмету ещё не добавлен. Пока можно открыть «🎓 Мои дисциплины» с сайта КрасГМУ — кнопка выше.'}
              action={{ label: 'Обновить', onClick: () => void load() }}
            />
          ) : (
            <EmptyState
              switcher={switcher}
              title={`Для группы ${studyGroup} занятий пока нет`}
              text="План кафедры ещё не открыт. Он появится здесь, как только будет готов."
              action={{ label: 'Обновить', onClick: () => void load() }}
            />
          )}
        </div>
      </div>
    );
  }

  const total = view.items.length;
  const doneCount = view.items.filter(i => done.has(i.lesson.id)).length;
  const controlCount = view.items.filter(i => i.lesson.kind !== 'lesson').length;
  const percent = total ? Math.round((doneCount / total) * 100) : 0;
  const nextItem = view.items.find(i => !done.has(i.lesson.id)) ?? null;

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-4 flex flex-col gap-2 pb-28" style={{ paddingTop: TOP_PAD }}>
          {/* Обложка курса: прогресс и следующее занятие */}
          <div
            className="relative overflow-hidden rounded-3xl p-4 flex flex-col gap-3.5"
            style={{
              background: `linear-gradient(150deg, color-mix(in srgb, ${view.color} 22%, var(--c-card)) 0%, var(--c-card) 75%)`,
              border: `1px solid color-mix(in srgb, ${view.color} 30%, var(--c-border))`,
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[20px] font-bold leading-tight"
                    style={{ color: 'var(--c-text)' }}
                  >
                    Занятия
                  </span>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: 'color-mix(in srgb, var(--c-primary) 14%, transparent)',
                      color: 'var(--c-primary)',
                    }}
                  >
                    {studyGroup}
                  </span>
                </div>
                <div className="mt-2">{switcher}</div>
                <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                  <MetaChip icon={<BookOpen className="w-3.5 h-3.5" />}>
                    {total - controlCount} {plural(total - controlCount, ['занятие', 'занятия', 'занятий'])}
                  </MetaChip>
                  {controlCount > 0 && (
                    <MetaChip icon={<GraduationCap className="w-3.5 h-3.5" />}>
                      {controlCount} {plural(controlCount, ['контрольная', 'контрольные', 'контрольных'])}
                    </MetaChip>
                  )}
                  {view.lectures.length > 0 && (
                    <MetaChip icon={<FileText className="w-3.5 h-3.5" />}>
                      {view.lectures.length} {plural(view.lectures.length, ['лекция', 'лекции', 'лекций'])}
                    </MetaChip>
                  )}
                </div>
              </div>
              <ProgressRing percent={percent} color={view.color} done={doneCount} total={total} />
            </div>

            {nextItem ? (
              <button
                type="button"
                onClick={() => setReadingId(nextItem.lesson.id)}
                className="flex items-center gap-3 w-full text-left rounded-2xl px-3.5 py-3 active:scale-[0.98] transition-transform duration-150"
                style={{ background: view.color, color: '#fff' }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[10.5px] font-bold uppercase tracking-widest opacity-80">
                    {doneCount ? 'Продолжить' : 'Начать'} · {KIND_LABELS[nextItem.lesson.kind]} №
                    {nextItem.lesson.planNumber ?? nextItem.lesson.order}
                  </span>
                  <span className="block text-[13.5px] font-semibold leading-snug truncate">
                    {nextItem.lesson.title}
                  </span>
                </span>
                <ArrowRight className="w-5 h-5 flex-shrink-0" />
              </button>
            ) : (
              <div
                className="flex items-center gap-2 rounded-2xl px-3.5 py-3 text-[13.5px] font-semibold"
                style={{
                  background: `color-mix(in srgb, ${view.color} 16%, transparent)`,
                  color: view.color,
                }}
              >
                <CheckCircle2 className="w-5 h-5" /> Весь курс пройден
              </div>
            )}
          </div>

          {view.items.map((item, i) => {
            const prev = i > 0 ? view.items[i - 1] : null;
            const title = sectionTitle(item);
            const showHeader = !prev || sectionTitle(prev) !== title;
            const group = showHeader ? view.items.filter(x => sectionTitle(x) === title) : [];
            return (
              <React.Fragment key={item.lesson.id}>
                {showHeader && (
                  <div className="flex items-center gap-2 px-1 pt-4 pb-0.5">
                    <span
                      className="flex-1 text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--c-muted)' }}
                    >
                      {title}
                    </span>
                    <span
                      className="text-[11px] font-semibold tabular-nums"
                      style={{ color: 'var(--c-muted)' }}
                    >
                      {group.filter(x => done.has(x.lesson.id)).length}/{group.length}
                    </span>
                  </div>
                )}
                <LessonRow
                  lesson={item.lesson}
                  accent={view.color}
                  isDone={done.has(item.lesson.id)}
                  isNext={nextItem?.lesson.id === item.lesson.id}
                  onOpen={() => setReadingId(item.lesson.id)}
                  onToggleDone={() => toggleDone(item.lesson.id)}
                />
              </React.Fragment>
            );
          })}

          {view.lectures.length > 0 && <LecturesBlock lectures={view.lectures} accent={view.color} />}

          {view.sourceDoc && (
            <div
              className="text-[11px] leading-relaxed mt-2 px-1"
              style={{ color: 'var(--c-muted)' }}
            >
              Источник: {view.sourceDoc}.
            </div>
          )}
        </div>
      </ScrollArea>

      <AnimatePresence>
        {reading && (
          <ReadingView
            item={reading}
            accent={view.color}
            subjectLabel={view.label}
            allItems={view.items}
            isDone={done.has(reading.lesson.id)}
            contentState={readingContentState}
            onRetryContent={() => void loadContent(reading.programId, reading.lesson.id)}
            onToggleDone={() => toggleDone(reading.lesson.id)}
            onOpenLesson={setReadingId}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onClose={() => setReadingId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Режим чтения ──────────────────────────────────────────────────────────

const BODY_COLOR = 'color-mix(in srgb, var(--c-text) 90%, transparent)';
const TEST_LETTERS = 'абвгдежзик';

function ReadingView({
  item,
  accent,
  subjectLabel,
  allItems,
  isDone,
  contentState,
  onRetryContent,
  onToggleDone,
  onOpenLesson,
  onPrev,
  onNext,
  onClose,
}: {
  item: FlatLesson;
  accent: string;
  subjectLabel: string;
  allItems: FlatLesson[];
  isDone: boolean;
  contentState: 'ready' | 'loading' | 'failed' | 'none';
  onRetryContent: () => void;
  onToggleDone: () => void;
  onOpenLesson: (lessonId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { lesson } = item;
  const isControl = lesson.kind !== 'lesson';
  const kindColor = isControl ? CONTROL_COLOR : accent;
  const number = lesson.planNumber ?? lesson.order;
  const [fontSize, setFontSize] = useState(16);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const initialDistance = useRef<number | null>(null);
  const initialFontSize = useRef(16);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { openZoom, overlay: zoomOverlay } = useImageZoom();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setSectionIndex(0);
    setVisited(new Set([0]));
  }, [lesson.id]);

  const sections = lesson.sections ?? [];
  const activeSection = sections[sectionIndex] ?? null;
  const termCount = useMemo(
    () => sections.reduce((n, s) => n + (s.terms?.length ?? 0), 0) || (lesson.terms?.length ?? 0),
    [sections, lesson.terms],
  );
  const position = allItems.findIndex(i => i.lesson.id === lesson.id);

  const stats = [
    { value: sections.length, forms: ['подтема', 'подтемы', 'подтем'] },
    { value: termCount, forms: ['термин', 'термина', 'терминов'] },
    { value: lesson.questions?.length ?? lesson.questionCount ?? 0, forms: ['вопрос', 'вопроса', 'вопросов'] },
    { value: lesson.tests?.length ?? lesson.testCount ?? 0, forms: ['тест', 'теста', 'тестов'] },
  ].filter(s => s.value > 0);

  const goSection = (i: number) => {
    if (i < 0 || i >= sections.length) return;
    setSectionIndex(i);
    setVisited(prev => new Set(prev).add(i));
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      initialDistance.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      initialFontSize.current = fontSize;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialDistance.current !== null) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      setFontSize(Math.max(12, Math.min(28, Math.round(
        initialFontSize.current * d / initialDistance.current,
      ))));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) initialDistance.current = null;
  };

  const covered = useMemo(() => {
    if (!lesson.covers?.length) return [];
    const set = new Set(lesson.covers);
    return allItems
      .map(i => i.lesson)
      .filter(l => l.planNumber && set.has(l.planNumber));
  }, [lesson.covers, allItems]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 80 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 80 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden"
      style={{ background: 'var(--c-bg)' }}
    >
      <div
        className="flex-shrink-0"
        style={{
          background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          paddingTop: 'calc(var(--header-pt) - 28px)',
        }}
      >
        <div className="flex items-center justify-center px-3 py-2">
          <div className="text-center min-w-0">
            <div
              className="text-[10px] font-bold uppercase tracking-widest truncate"
              style={{ color: 'var(--c-muted)' }}
            >
              {subjectLabel}
            </div>
            <div
              className="text-[12px] font-bold leading-tight tabular-nums"
              style={{ color: 'var(--c-text)' }}
            >
              {position + 1} из {allItems.length}
            </div>
          </div>
        </div>
        {/* Где это занятие в курсе */}
        <div className="h-[3px]" style={{ background: 'var(--c-border)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${allItems.length ? ((position + 1) / allItems.length) * 100 : 0}%`,
              background: accent,
            }}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pt-3 scroll-container"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex flex-col gap-3.5 pb-32 max-w-2xl mx-auto w-full overflow-x-hidden">
          {/* Обложка занятия */}
          <div
            className="relative overflow-hidden rounded-3xl px-4 pt-4 pb-4 flex flex-col gap-3"
            style={{
              background: `linear-gradient(150deg, color-mix(in srgb, ${kindColor} 22%, var(--c-card)) 0%, var(--c-card) 75%)`,
              border: `1px solid color-mix(in srgb, ${kindColor} 32%, var(--c-border))`,
            }}
          >
            <span
              aria-hidden
              className="absolute -right-1 -top-5 font-black tabular-nums select-none pointer-events-none"
              style={{ fontSize: 112, lineHeight: 1, color: kindColor, opacity: 0.1 }}
            >
              {number}
            </span>

            <div className="relative flex items-center gap-1.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{ background: kindColor, color: '#fff' }}
              >
                {isControl
                  ? <GraduationCap className="w-3.5 h-3.5" />
                  : <BookOpen className="w-3.5 h-3.5" />}
                {KIND_LABELS[lesson.kind]} №{number}
              </span>
              {isDone && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{
                    background: 'color-mix(in srgb, var(--c-card) 70%, transparent)',
                    color: kindColor,
                    border: `1px solid color-mix(in srgb, ${kindColor} 35%, transparent)`,
                  }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Пройдено
                </span>
              )}
            </div>

            <h2
              className="relative font-bold leading-snug break-words"
              style={{ fontSize: `${fontSize * 1.2}px`, color: 'var(--c-text)' }}
            >
              {lesson.title}
            </h2>

            <div className="relative flex items-center gap-1.5 flex-wrap">
              <MetaChip icon={<CalendarDays className="w-3.5 h-3.5" />}>
                {sectionTitle(item)}
              </MetaChip>
              {lesson.hours ? (
                <MetaChip icon={<Clock className="w-3.5 h-3.5" />}>{lesson.hours} ч</MetaChip>
              ) : null}
            </div>

            {stats.length > 0 && (
              <div
                className="relative grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
              >
                {stats.map(s => (
                  <div
                    key={s.forms[0]}
                    className="rounded-xl px-2 py-1.5 text-center"
                    style={{ background: 'color-mix(in srgb, var(--c-bg) 55%, transparent)' }}
                  >
                    <div
                      className="text-[17px] font-extrabold tabular-nums leading-tight"
                      style={{ color: kindColor }}
                    >
                      {s.value}
                    </div>
                    <div className="text-[10.5px] leading-tight" style={{ color: 'var(--c-muted)' }}>
                      {plural(s.value, s.forms)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {lesson.summary && (
            <div
              className="rounded-2xl px-4 py-3.5 flex flex-col gap-1.5"
              style={{
                background: `color-mix(in srgb, ${accent} 7%, var(--c-card))`,
                borderLeft: `3px solid ${accent}`,
              }}
            >
              <div className="flex items-center gap-1.5" style={{ color: accent }}>
                <Lightbulb className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-widest">
                  Коротко о теме
                </span>
              </div>
              <div
                className="leading-relaxed break-words"
                style={{ fontSize: `${fontSize}px`, color: BODY_COLOR }}
              >
                {lesson.summary}
              </div>
            </div>
          )}

          {lesson.objectives?.length ? (
            <Panel icon={<Target className="w-4 h-4" />} label="Что уметь к паре" color={accent}>
              <ul className="flex flex-col gap-2.5">
                {lesson.objectives.map((text, i) => (
                  <li key={i} className="flex gap-2.5">
                    <NumberDot n={i + 1} color={accent} />
                    <span
                      className="leading-snug break-words"
                      style={{ fontSize: `${fontSize * 0.94}px`, color: BODY_COLOR }}
                    >
                      {text}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {covered.length > 0 && (
            <Panel
              icon={<GraduationCap className="w-4 h-4" />}
              label={`Что войдёт · ${covered.length} ${plural(covered.length, ['тема', 'темы', 'тем'])}`}
              color={CONTROL_COLOR}
            >
              <div className="flex flex-col -mx-1">
                {covered.map((l, i) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onOpenLesson(l.id)}
                    className="flex items-center gap-2.5 text-left px-1 py-2 rounded-lg active:opacity-60 transition-opacity"
                    style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : undefined }}
                  >
                    <NumberDot n={l.planNumber ?? l.order} color={CONTROL_COLOR} />
                    <span
                      className="flex-1 leading-snug break-words"
                      style={{ fontSize: `${fontSize * 0.92}px`, color: BODY_COLOR }}
                    >
                      {l.title}
                    </span>
                    <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-muted)' }} />
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {sections.length > 0 && activeSection && (
            <div className="flex flex-col gap-2.5 pt-1">
              <div className="flex items-center gap-2 px-1">
                <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: accent }} />
                <span
                  className="flex-1 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: accent }}
                >
                  Конспект
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--c-muted)' }}>
                  {visited.size} из {sections.length} прочитано
                </span>
              </div>
              {sections.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                  {sections.map((section, i) => {
                    const active = i === sectionIndex;
                    const seen = visited.has(i);
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => goSection(i)}
                        className="flex-shrink-0 text-[12px] font-bold tabular-nums w-8 h-8 rounded-full transition-colors"
                        style={{
                          background: active
                            ? accent
                            : seen ? `color-mix(in srgb, ${accent} 16%, var(--c-card))` : 'var(--c-card)',
                          color: active ? '#fff' : seen ? accent : 'var(--c-muted)',
                          border: `1px solid ${active || seen
                            ? `color-mix(in srgb, ${accent} 50%, transparent)`
                            : 'var(--c-border)'}`,
                        }}
                        aria-label={section.title}
                        aria-current={active ? 'step' : undefined}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              )}
              <SectionPage
                section={activeSection}
                index={sectionIndex + 1}
                total={sections.length}
                accent={accent}
                fontSize={fontSize}
                onZoom={openZoom}
                onPrev={() => goSection(sectionIndex - 1)}
                onNext={() => goSection(sectionIndex + 1)}
                hasPrev={sectionIndex > 0}
                hasNext={sectionIndex < sections.length - 1}
                allRead={visited.size === sections.length}
              />
            </div>
          )}

          {!sections.length && lesson.terms?.length ? (
            <Panel
              icon={<Languages className="w-4 h-4" />}
              label={`Термины · ${lesson.terms.length}`}
              color={accent}
            >
              <TermList terms={lesson.terms} accent={accent} fontSize={fontSize} />
            </Panel>
          ) : null}

          {contentState === 'loading' && (
            <div
              className="rounded-2xl px-4 py-4 flex flex-col gap-2.5 animate-pulse"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              aria-label="Загружаем текст занятия"
            >
              {[70, 100, 92, 60].map((w, i) => (
                <div
                  key={i}
                  className="h-3 rounded-full"
                  style={{ width: `${w}%`, background: 'var(--c-border)' }}
                />
              ))}
            </div>
          )}
          {contentState === 'failed' && (
            <button
              type="button"
              onClick={onRetryContent}
              className="rounded-2xl px-4 py-3 text-[13px] font-semibold text-left active:opacity-70"
              style={{
                color: accent,
                background: 'var(--c-card)',
                border: `1px dashed color-mix(in srgb, ${accent} 50%, var(--c-border))`,
              }}
            >
              Не удалось загрузить текст занятия. Повторить
            </button>
          )}

          {lesson.annotation?.length ? (
            <AnnotationView blocks={lesson.annotation} accent={accent} fontSize={fontSize} />
          ) : null}

          {lesson.questions?.length ? (
            <QuestionsView key={`q-${lesson.id}`} questions={lesson.questions} accent={accent} fontSize={fontSize} />
          ) : null}

          {lesson.tests?.length ? (
            <TestsView key={`t-${lesson.id}`} tests={lesson.tests} accent={accent} fontSize={fontSize} />
          ) : null}

          {lesson.note && (
            <div
              className="rounded-2xl px-4 py-3 flex gap-2.5 leading-relaxed"
              style={{
                fontSize: `${fontSize * 0.85}px`,
                color: 'var(--c-muted)',
                background: 'var(--c-bg-subtle)',
                border: '1px solid var(--c-border)',
              }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{lesson.note}</span>
            </div>
          )}
        </div>
      </div>

      <div
        className="fixed left-0 right-0 px-5 z-[110] flex justify-center"
        style={{ bottom: 'calc(var(--nav-bottom, 12px) + 12px)' }}
      >
        <div
          className="flex items-center gap-1.5 p-1.5 rounded-[28px] shadow-2xl"
          style={{
            background: 'var(--c-nav-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1.5px solid var(--c-nav-border)',
            boxShadow: '0 8px 32px hsl(0 0% 0% / 0.4)',
          }}
        >
          <button
            type="button"
            onClick={onPrev}
            className="w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-95"
            style={{ color: 'var(--c-muted)' }}
            aria-label="Предыдущее занятие"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={onToggleDone}
            className="flex items-center justify-center gap-2 px-4 h-10 rounded-full text-sm font-bold transition-all active:scale-[0.97]"
            style={isDone
              ? { background: 'var(--c-primary)', color: 'hsl(var(--primary-foreground))' }
              : {
                background: 'var(--c-primary-dim)',
                color: 'var(--c-primary)',
                border: '1px solid var(--c-primary-br)',
              }}
          >
            {isDone
              ? <><CheckCircle2 className="w-4 h-4" /> Пройдено</>
              : <><Circle className="w-4 h-4" /> Прошёл</>}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center gap-2 px-4 h-10 rounded-full text-sm font-semibold transition-all active:scale-[0.97]"
            style={{ color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}
          >
            <X className="w-4 h-4" /> Выйти
          </button>

          <button
            type="button"
            onClick={onNext}
            className="w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-95"
            style={{ color: 'var(--c-muted)' }}
            aria-label="Следующее занятие"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      {zoomOverlay}
    </motion.div>
  );
}

function MetaChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full"
      style={{
        color: 'var(--c-muted)',
        background: 'color-mix(in srgb, var(--c-bg) 55%, transparent)',
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function NumberDot({ n, color }: { n: number; color: string }) {
  return (
    <span
      className="flex-shrink-0 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-full text-[11px] font-extrabold tabular-nums"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      {n}
    </span>
  );
}

/** Карточка блока занятия: заголовок с иконкой и содержимое. */
function Panel({
  icon, label, color, children,
}: { icon: React.ReactNode; label: string; color: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl px-4 py-3.5 flex flex-col gap-3"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <div className="flex items-center gap-2" style={{ color }}>
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      {children}
    </div>
  );
}

/** Русское название и латынь под ним, строки разделены линией. */
function TermList({ terms, accent, fontSize }: { terms: string[]; accent: string; fontSize: number }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)' }}
    >
      {terms.map((term, i) => {
        const { ru, la } = splitTerm(term);
        return (
          <div
            key={term}
            className="flex flex-col gap-0.5 px-3 py-2"
            style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : undefined }}
          >
            <span
              className="leading-snug break-words"
              style={{ fontSize: `${fontSize * 0.88}px`, color: BODY_COLOR }}
            >
              {ru}
            </span>
            {la && (
              <span
                className="leading-snug break-words italic font-medium"
                style={{ fontSize: `${fontSize * 0.84}px`, color: accent }}
              >
                {la}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Аннотация методички: абзацы, списки и таблицы как на сайте кафедры. */
function AnnotationView({
  blocks, accent, fontSize,
}: { blocks: AnnotationBlock[]; accent: string; fontSize: number }) {
  return (
    <Panel icon={<FileText className="w-4 h-4" />} label="Аннотация кафедры" color={accent}>
      <div className="flex flex-col gap-2.5">
        {blocks.map((b, i) => {
          if (b.type === 'table') {
            const [head, ...body] = b.rows;
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-lg"
                style={{ border: '1px solid var(--c-border)' }}
              >
                <table
                  className="w-full border-collapse"
                  style={{ fontSize: `${fontSize * 0.82}px`, color: BODY_COLOR }}
                >
                  {body.length > 0 && (
                    <thead>
                      <tr style={{ background: `color-mix(in srgb, ${accent} 10%, var(--c-bg-subtle))` }}>
                        {head.map((c, ci) => (
                          <th
                            key={ci}
                            className="text-left font-bold px-2.5 py-1.5 align-top"
                            style={{ borderBottom: '1px solid var(--c-border)' }}
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {(body.length > 0 ? body : [head]).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((c, ci) => (
                          <td
                            key={ci}
                            className="px-2.5 py-1.5 align-top"
                            style={{ borderTop: ri > 0 ? '1px solid var(--c-border)' : undefined }}
                          >
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          if (b.type === 'li') {
            return (
              <div key={i} className="flex gap-2.5 pl-1">
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ background: accent, marginTop: `${fontSize * 0.55}px` }}
                />
                <span
                  className="leading-relaxed break-words"
                  style={{ fontSize: `${fontSize * 0.94}px`, color: BODY_COLOR }}
                >
                  {b.text}
                </span>
              </div>
            );
          }
          return (
            <p
              key={i}
              className="leading-relaxed break-words"
              style={{ fontSize: `${fontSize}px`, color: BODY_COLOR }}
            >
              {b.text}
            </p>
          );
        })}
      </div>
    </Panel>
  );
}

/** Сворачиваемая карточка: вопросов и тестов в методичке десятки. */
function CollapsibleBlock({
  icon, label, count, hint, accent, children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  /** Подпись под заголовком в свёрнутом виде */
  hint?: string;
  accent: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 w-full text-left px-4 py-3.5 active:opacity-70 transition-opacity"
        aria-expanded={open}
      >
        <span
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          {icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold" style={{ color: 'var(--c-text)' }}>
            {label}
          </span>
          <span className="block text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
            {open ? 'Нажми, чтобы свернуть' : hint ?? `${count} из методички`}
          </span>
        </span>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 transition-transform"
          style={{ color: 'var(--c-muted)', transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {open && (
        <div className="px-4 pt-3 pb-4" style={{ borderTop: '1px solid var(--c-border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function QuestionsView({
  questions, accent, fontSize,
}: { questions: string[]; accent: string; fontSize: number }) {
  return (
    <CollapsibleBlock
      icon={<HelpCircle className="w-4 h-4" />}
      label="Вопросы по теме"
      count={questions.length}
      accent={accent}
    >
      <ol className="flex flex-col gap-2.5">
        {questions.map((q, i) => (
          <li key={i} className="flex gap-2.5">
            <NumberDot n={i + 1} color={accent} />
            <span
              className="leading-snug break-words"
              style={{ fontSize: `${fontSize * 0.94}px`, color: BODY_COLOR }}
            >
              {q}
            </span>
          </li>
        ))}
      </ol>
    </CollapsibleBlock>
  );
}

function TestsView({
  tests, accent, fontSize,
}: { tests: LessonTest[]; accent: string; fontSize: number }) {
  return (
    <CollapsibleBlock
      icon={<ListChecks className="w-4 h-4" />}
      label="Тесты для самопроверки"
      count={tests.length}
      accent={accent}
    >
      <ol className="flex flex-col gap-4">
        {tests.map((t, i) => (
          <li key={i} className="flex flex-col gap-2">
            <div className="flex gap-2.5">
              <NumberDot n={i + 1} color={accent} />
              <span
                className="leading-snug font-semibold break-words"
                style={{ fontSize: `${fontSize * 0.92}px`, color: 'var(--c-text)' }}
              >
                {t.question}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5 pl-8">
              {t.options.map((o, oi) => (
                <li
                  key={oi}
                  className="flex gap-2 items-start leading-snug break-words rounded-lg px-2.5 py-1.5"
                  style={{
                    fontSize: `${fontSize * 0.88}px`,
                    color: 'color-mix(in srgb, var(--c-text) 88%, transparent)',
                    background: 'var(--c-bg-subtle)',
                  }}
                >
                  <span className="flex-shrink-0 font-bold" style={{ color: 'var(--c-muted)' }}>
                    {TEST_LETTERS[oi] ?? oi + 1})
                  </span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </CollapsibleBlock>
  );
}

/** Одна подтема целиком — как страница конспекта, без сворачивания. */
function SectionPage({
  section,
  index,
  total,
  accent,
  fontSize,
  onZoom,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  allRead,
}: {
  section: LessonSection;
  index: number;
  total: number;
  accent: string;
  fontSize: number;
  onZoom: (list: string[], idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  allRead: boolean;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4 flex flex-col gap-3"
      style={{
        background: 'var(--c-card)',
        border: `1px solid color-mix(in srgb, ${accent} 35%, var(--c-border))`,
      }}
    >
      <div className="flex flex-col gap-1">
        <span
          className="text-[10.5px] font-bold uppercase tracking-widest tabular-nums"
          style={{ color: accent }}
        >
          Подтема {index} из {total}
        </span>
        <h3
          className="font-semibold leading-snug"
          style={{ fontSize: `${fontSize * 1.05}px`, color: 'var(--c-text)' }}
        >
          {section.title}
        </h3>
      </div>

      <div
        className="leading-relaxed break-words"
        style={{ fontSize: `${fontSize * 0.94}px`, color: BODY_COLOR }}
      >
        {section.text}
      </div>

      <ReadingImages images={section.images} onZoom={onZoom} />

      {section.atlas ? <TermAtlas atlasId={section.atlas} accent={accent} /> : null}

      {section.terms?.length ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-1.5" style={{ color: accent }}>
            <Languages className="w-3.5 h-3.5" />
            <span className="text-[10.5px] font-bold uppercase tracking-widest">
              Латынь · {section.terms.length}
            </span>
          </div>
          <TermList terms={section.terms} accent={accent} fontSize={fontSize} />
        </div>
      ) : null}

      {total > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev}
            className="flex items-center gap-1 text-[12.5px] font-semibold px-3.5 py-2 rounded-full disabled:opacity-30 active:scale-95 transition-transform duration-150"
            style={{ color: accent, border: `1px solid color-mix(in srgb, ${accent} 50%, transparent)` }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Назад
          </button>
          {hasNext ? (
            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1 text-[12.5px] font-semibold px-3.5 py-2 rounded-full active:scale-95 transition-transform duration-150"
              style={{ background: accent, color: '#fff' }}
            >
              Дальше <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span
              className="flex items-center gap-1 text-[12.5px] font-semibold px-1"
              style={{ color: accent }}
            >
              {allRead ? <><CheckCircle2 className="w-4 h-4" /> Конспект прочитан</> : "Последняя подтема"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Список ────────────────────────────────────────────────────────────────

function ProgressRing({
  percent, color, done, total,
}: { percent: number; color: string; done: number; total: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative flex-shrink-0 w-[60px] h-[60px]"
      aria-label={`Пройдено ${done} из ${total}`}
    >
      <svg viewBox="0 0 60 60" className="w-full h-full -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" strokeWidth="6" style={{ stroke: 'var(--c-border)' }} />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          style={{ stroke: color, transition: 'stroke-dashoffset 300ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[13px] font-extrabold tabular-nums" style={{ color: 'var(--c-text)' }}>
          {done}
        </span>
        <span className="text-[9.5px] tabular-nums mt-0.5" style={{ color: 'var(--c-muted)' }}>
          из {total}
        </span>
      </div>
    </div>
  );
}

function LessonRow({
  lesson,
  accent,
  isDone,
  isNext,
  onOpen,
  onToggleDone,
}: {
  lesson: Lesson;
  accent: string;
  isDone: boolean;
  isNext: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}) {
  const isControl = lesson.kind !== 'lesson';
  const color = isControl ? CONTROL_COLOR : accent;
  const number = lesson.planNumber ?? lesson.order;

  const meta: string[] = [];
  if (isControl) {
    meta.push(lesson.covers?.length
      ? `${KIND_LABELS[lesson.kind]} · темы ${formatCovers(lesson.covers)}`
      : KIND_LABELS[lesson.kind]);
  }
  if (lesson.sections?.length) {
    meta.push(`${lesson.sections.length} ${plural(lesson.sections.length, ['подтема', 'подтемы', 'подтем'])}`);
  }
  if (lesson.questionCount) {
    meta.push(`${lesson.questionCount} ${plural(lesson.questionCount, ['вопрос', 'вопроса', 'вопросов'])}`);
  }
  if (lesson.testCount) {
    meta.push(`${lesson.testCount} ${plural(lesson.testCount, ['тест', 'теста', 'тестов'])}`);
  }

  return (
    <div
      className="flex items-stretch rounded-2xl overflow-hidden"
      style={{
        background: isControl
          ? `color-mix(in srgb, ${CONTROL_COLOR} 7%, var(--c-card))`
          : 'var(--c-card)',
        border: `1px solid ${isNext || isControl
          ? `color-mix(in srgb, ${color} 45%, var(--c-border))`
          : 'var(--c-border)'}`,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 flex items-center gap-3 text-left min-w-0 pl-3 pr-2 py-3 active:opacity-70 transition-opacity"
      >
        <span
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-extrabold tabular-nums"
          style={isDone
            ? { background: color, color: '#fff' }
            : { background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
        >
          {isControl ? <GraduationCap className="w-5 h-5" /> : number}
        </span>
        <span className="flex-1 min-w-0">
          {isNext && (
            <span
              className="block text-[10px] font-bold uppercase tracking-widest mb-0.5"
              style={{ color }}
            >
              Следующее
            </span>
          )}
          <span
            className="text-[14px] font-semibold leading-snug break-words overflow-hidden"
            style={{
              color: isDone ? 'var(--c-muted)' : 'var(--c-text)',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
            }}
          >
            {lesson.title}
          </span>
          {meta.length > 0 && (
            <span
              className="block text-[11.5px] mt-1 leading-snug"
              style={{ color: isControl ? CONTROL_COLOR : 'var(--c-muted)' }}
            >
              {meta.join(' · ')}
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleDone}
        className="flex-shrink-0 w-12 flex items-center justify-center active:scale-90 transition-transform duration-150"
        aria-label={isDone ? 'Снять отметку' : 'Отметить как пройденное'}
        style={{ color: isDone ? color : 'var(--c-muted)', borderLeft: '1px solid var(--c-border)' }}
      >
        {isDone
          ? <CheckCircle2 className="w-[22px] h-[22px]" />
          : <Circle className="w-[22px] h-[22px]" />}
      </button>
    </div>
  );
}

function LecturesBlock({ lectures, accent }: { lectures: Lecture[]; accent: string }) {
  return (
    <div className="mt-3">
      <CollapsibleBlock
        icon={<FileText className="w-4 h-4" />}
        label="Лекции курса"
        count={lectures.length}
        hint={`${lectures.length} ${plural(lectures.length, ['лекция', 'лекции', 'лекций'])} по плану кафедры`}
        accent={accent}
      >
        <div className="flex flex-col gap-3">
          {lectures.map(lec => (
            <div key={lec.id} className="flex gap-2.5">
              <NumberDot n={lec.planNumber ?? lec.order} color={accent} />
              <span className="flex-1 min-w-0">
                <span
                  className="block text-[13px] font-semibold leading-snug"
                  style={{ color: 'var(--c-text)' }}
                >
                  {lec.title}
                </span>
                {lec.summary && (
                  <span
                    className="block text-[12px] leading-snug mt-1"
                    style={{ color: 'var(--c-muted)' }}
                  >
                    {lec.summary}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleBlock>
    </div>
  );
}

/** Текущий предмет кнопкой; по нажатию снизу выезжает список предметов курса. */
function SubjectSwitcher({
  options,
  active,
  onSelect,
}: {
  options: LessonSubjectOption[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.id === active) ?? options[0];
  if (!current) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 max-w-full pl-3 pr-2.5 py-1.5 rounded-full text-[13px] font-semibold active:scale-95 transition-transform duration-150"
        style={{
          background: 'color-mix(in srgb, var(--c-bg) 55%, transparent)',
          color: 'var(--c-text)',
          border: `1px solid color-mix(in srgb, ${current.color} 40%, var(--c-border))`,
        }}
        aria-haspopup="dialog"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: current.color }} />
        <span className="truncate">{current.label}</span>
        <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-muted)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[130] flex flex-col justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ background: 'hsl(0 0% 0% / 0.45)' }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-label="Выбор предмета"
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              transition={{ type: 'spring', damping: 30, stiffness: 340 }}
              className="rounded-t-3xl px-4 pt-3 flex flex-col gap-1 text-left"
              style={{
                background: 'var(--c-card)',
                borderTop: '1px solid var(--c-border)',
                paddingBottom: 'calc(var(--nav-bottom, 0px) + 20px)',
                maxHeight: '70vh',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div
                className="w-10 h-1 rounded-full mx-auto mb-2 flex-shrink-0"
                style={{ background: 'var(--c-border)' }}
              />
              <div
                className="text-[11px] font-bold uppercase tracking-widest px-2 pb-1 flex-shrink-0"
                style={{ color: 'var(--c-muted)' }}
              >
                Предмет
              </div>
              <div className="overflow-y-auto flex flex-col gap-1">
                {options.map(o => {
                  const isActive = o.id === active;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => { setOpen(false); onSelect(o.id); }}
                      className="flex items-center gap-3 w-full text-left px-3 py-3 rounded-2xl active:opacity-70 transition-opacity"
                      style={{
                        background: isActive ? `color-mix(in srgb, ${o.color} 14%, transparent)` : undefined,
                      }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: o.color }} />
                      <span
                        className="flex-1 text-[15px] font-semibold"
                        style={{ color: isActive ? o.color : 'var(--c-text)' }}
                      >
                        {o.label}
                      </span>
                      {isActive && <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: o.color }} />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function EmptyState({
  title,
  text,
  action,
  switcher,
}: {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
  /** Переключатель предмета над сообщением */
  switcher?: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-3">
      {switcher && <div className="mb-3">{switcher}</div>}
      <CalendarDays className="w-7 h-7" style={{ color: 'var(--c-muted)' }} />
      <div className="text-[15px] font-bold" style={{ color: 'var(--c-text)' }}>
        {title}
      </div>
      <div className="text-[13px] leading-relaxed" style={{ color: 'var(--c-muted)' }}>
        {text}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 text-[13px] font-bold px-4 py-2 rounded-full active:scale-95 transition-transform duration-150"
          style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function plural(n: number, [one, few, many]: string[]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «Нижний альвеолярный нерв — nervus alveolaris inferior» → русская и латинская строки. */
function splitTerm(term: string): { ru: string; la: string | null } {
  const i = term.indexOf(' — ');
  if (i < 0) return { ru: term, la: null };
  const ru = term.slice(0, i).trim();
  const la = term.slice(i + 3).trim();
  return { ru, la: la || null };
}

/** [31,32,33,34] → «31–34», [1,2,3,5,6] → «1–3, 5, 6» */
function formatCovers(covers: number[]): string {
  const sorted = [...new Set(covers)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[last.length - 1] + 1) last.push(n);
    else runs.push([n]);
  }
  return runs
    .map(run => (run.length > 2 ? `${run[0]}–${run[run.length - 1]}` : run.join(', ')))
    .join(', ');
}
