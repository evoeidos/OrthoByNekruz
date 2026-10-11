"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Circle, GraduationCap, HelpCircle, ListChecks, Target, X,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  AnnotationBlock, Lecture, Lesson, LessonKind, LessonSection, LessonTest,
} from '@/lib/curriculum';
import { ReadingImages, useImageZoom } from '@/components/ImageZoom';
import { TermAtlas } from '@/components/TermAtlas';
import { getSubject } from '@/lib/subjects';

// Локальная копия подписей: импорт значения из curriculum притащил бы в
// клиентский бандл все планы кафедр из файлов.
const KIND_LABELS: Record<LessonKind, string> = {
  lesson: 'Занятие',
  control: 'Контрольная',
  colloquium: 'Коллоквиум',
};

const CONTROL_COLOR = '#B4801F';

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
        body: JSON.stringify({ telegramId: tgId, initData, subjectId: subject }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error || 'Ошибка'));
      setStudyGroup(d.studyGroup ?? null);
      setPrograms((d.programs as StudentProgram[]) ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [subject]);

  useEffect(() => { void load(); }, [load]);

  const subjects = useMemo(() => buildSubjectViews(programs), [programs]);

  const view = useMemo(
    () => subjects.find(s => s.subjectId === subject) ?? null,
    [subjects, subject],
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
        body: JSON.stringify({ telegramId: tgId, initData, subjectId: subject, programId, lessonId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error || 'Ошибка'));
      setContents(prev => ({ ...prev, [key]: (d.content ?? {}) as LessonContent }));
    } catch {
      setContents(prev => ({ ...prev, [key]: 'failed' }));
    }
  }, [subject]);

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
      <EmptyState
        title="Сначала укажи группу"
        text="Занятия приходят из плана кафедры для конкретной группы. Как только группа будет указана, здесь появится весь курс."
        action={onOpenProfile ? { label: 'В профиль', onClick: onOpenProfile } : undefined}
      />
    );
  }

  if (!view) {
    const subjectLabel = getSubject(subject)?.label;
    if (subjectLabel) {
      return (
        <EmptyState
          title={`Занятия по предмету «${subjectLabel}» готовятся`}
          text="План кафедры по этому предмету ещё не добавлен. Он появится здесь, как только будет готов."
          action={{ label: 'Обновить', onClick: () => void load() }}
        />
      );
    }
    return (
      <EmptyState
        title={`Для группы ${studyGroup} занятий пока нет`}
        text="План кафедры ещё не открыт. Он появится здесь сразу после того, как предмет станет доступен."
        action={{ label: 'Обновить', onClick: () => void load() }}
      />
    );
  }

  const doneCount = view.items.filter(i => done.has(i.lesson.id)).length;
  const controlCount = view.items.filter(i => i.lesson.kind !== 'lesson').length;

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-shrink-0 px-4 pt-4 pb-3"
        style={{ borderBottom: '1px solid var(--c-border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[19px] font-bold leading-tight"
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
        <div className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--c-muted)' }}>
          {view.label} · весь курс, {view.items.length} занятий
        </div>

        <div
          className="flex items-center gap-1.5 mt-3 text-[11.5px]"
          style={{ color: 'var(--c-muted)' }}
        >
          <div
            className="flex-1 h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--c-border)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${view.items.length ? (doneCount / view.items.length) * 100 : 0}%`,
                background: view.color,
              }}
            />
          </div>
          <span className="tabular-nums">{doneCount} из {view.items.length}</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-3 flex flex-col gap-2 pb-28">
          {view.items.map((item, i) => {
            const prev = i > 0 ? view.items[i - 1] : null;
            const showHeader = !prev || sectionTitle(prev) !== sectionTitle(item);
            return (
              <React.Fragment key={item.lesson.id}>
                {showHeader && (
                  <div
                    className="text-[11px] font-bold uppercase tracking-wider px-1 pt-3 pb-0.5"
                    style={{ color: 'var(--c-muted)' }}
                  >
                    {sectionTitle(item)}
                  </div>
                )}
                <LessonRow
                  lesson={item.lesson}
                  accent={view.color}
                  isDone={done.has(item.lesson.id)}
                  onOpen={() => setReadingId(item.lesson.id)}
                  onToggleDone={() => toggleDone(item.lesson.id)}
                />
              </React.Fragment>
            );
          })}

          {view.lectures.length > 0 && <LecturesBlock lectures={view.lectures} />}

          <div
            className="text-[11px] leading-relaxed mt-2 px-1"
            style={{ color: 'var(--c-muted)' }}
          >
            {view.items.length - controlCount} практических занятий и {controlCount}{' '}
            контрольных точек.
            {view.sourceDoc ? ` Источник: ${view.sourceDoc}.` : ''}
          </div>
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

function ReadingView({
  item,
  accent,
  subjectLabel,
  allItems,
  isDone,
  contentState,
  onRetryContent,
  onToggleDone,
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
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { lesson } = item;
  const isControl = lesson.kind !== 'lesson';
  const [fontSize, setFontSize] = useState(16);
  const [sectionIndex, setSectionIndex] = useState(0);
  const initialDistance = useRef<number | null>(null);
  const initialFontSize = useRef(16);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { openZoom, overlay: zoomOverlay } = useImageZoom();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setSectionIndex(0);
  }, [lesson.id]);

  const sections = lesson.sections ?? [];
  const activeSection = sections[sectionIndex] ?? null;
  const termCount = useMemo(
    () => sections.reduce((n, s) => n + (s.terms?.length ?? 0), 0),
    [sections],
  );

  const goSection = (i: number) => {
    if (i < 0 || i >= sections.length) return;
    setSectionIndex(i);
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
        className="flex items-center justify-center px-3 py-2 flex-shrink-0"
        style={{
          background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--c-border)',
          paddingTop: 'calc(var(--header-pt) - 28px)',
        }}
      >
        <div className="text-center min-w-0">
          <div
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--c-muted)' }}
          >
            Чтение
          </div>
          <div
            className="text-[12px] font-mono font-bold leading-tight"
            style={{ color: 'var(--c-text)' }}
          >
            Тема {lesson.planNumber ?? lesson.order} · {subjectLabel}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 pt-2 scroll-container"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="space-y-4 pb-32 max-w-2xl mx-auto w-full overflow-x-hidden">
          <div className="flex items-center gap-2 pt-2 flex-wrap">
            <span
              className="text-[11px] font-mono font-bold px-3 py-1 rounded-lg"
              style={{
                background: isControl
                  ? `color-mix(in srgb, ${CONTROL_COLOR} 16%, transparent)`
                  : 'var(--c-primary-dim)',
                color: isControl ? CONTROL_COLOR : 'var(--c-primary)',
                border: `1px solid ${isControl
                  ? `color-mix(in srgb, ${CONTROL_COLOR} 40%, transparent)`
                  : 'var(--c-primary-br)'}`,
              }}
            >
              {KIND_LABELS[lesson.kind]} №{lesson.planNumber ?? lesson.order}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--c-muted)' }}>
              {sectionTitle(item)}
              {lesson.hours ? ` · ${lesson.hours} ч` : ''}
            </span>
          </div>

          <h2
            className="font-semibold leading-snug break-words"
            style={{ fontSize: `${fontSize * 1.15}px`, color: 'var(--c-text)' }}
          >
            {lesson.title}
          </h2>

          {lesson.summary && (
            <div
              className="leading-relaxed font-normal break-words"
              style={{
                fontSize: `${fontSize}px`,
                color: 'color-mix(in srgb, var(--c-text) 92%, transparent)',
              }}
            >
              {lesson.summary}
            </div>
          )}

          {sections.length > 0 && activeSection && (
            <>
              <div
                className="flex items-center gap-2"
                style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}
              >
                <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: accent }} />
                <span
                  className="flex-1 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: accent }}
                >
                  Подтема {sectionIndex + 1} из {sections.length}
                  {termCount ? ` · ${termCount} терминов` : ''}
                </span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {sections.map((section, i) => {
                  const active = i === sectionIndex;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => goSection(i)}
                      className="flex-shrink-0 text-[12px] font-bold tabular-nums w-8 h-8 rounded-full"
                      style={{
                        background: active
                          ? accent
                          : 'var(--c-card)',
                        color: active ? '#fff' : 'var(--c-muted)',
                        border: `1px solid ${active ? accent : 'var(--c-border)'}`,
                      }}
                      aria-label={section.title}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <SectionPage
                section={activeSection}
                index={sectionIndex + 1}
                accent={accent}
                fontSize={fontSize}
                onZoom={openZoom}
                onPrev={() => goSection(sectionIndex - 1)}
                onNext={() => goSection(sectionIndex + 1)}
                hasPrev={sectionIndex > 0}
                hasNext={sectionIndex < sections.length - 1}
              />
            </>
          )}

          {contentState === 'loading' && (
            <div className="text-[12px] py-2" style={{ color: 'var(--c-muted)' }}>
              Загружаем текст занятия…
            </div>
          )}
          {contentState === 'failed' && (
            <button
              type="button"
              onClick={onRetryContent}
              className="text-[12px] font-semibold py-2 text-left active:opacity-70"
              style={{ color: accent }}
            >
              Не удалось загрузить текст занятия. Повторить
            </button>
          )}

          {lesson.annotation?.length ? (
            <AnnotationView blocks={lesson.annotation} accent={accent} fontSize={fontSize} />
          ) : null}

          {lesson.questions?.length ? (
            <QuestionsView questions={lesson.questions} accent={accent} fontSize={fontSize} />
          ) : null}

          {lesson.tests?.length ? (
            <TestsView tests={lesson.tests} accent={accent} fontSize={fontSize} />
          ) : null}

          {lesson.objectives?.length ? (
            <>
              <div
                className="flex items-center gap-3"
                style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}
              >
                <Target className="w-4 h-4 flex-shrink-0" style={{ color: accent }} />
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: accent }}
                >
                  Что уметь к паре
                </span>
              </div>
              <ul className="flex flex-col gap-2.5">
                {lesson.objectives.map((text, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span
                      className="flex-shrink-0 font-extrabold tabular-nums"
                      style={{ fontSize: `${fontSize * 0.8}px`, color: accent, marginTop: 2 }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="leading-snug break-words"
                      style={{
                        fontSize: `${fontSize * 0.94}px`,
                        color: 'color-mix(in srgb, var(--c-text) 92%, transparent)',
                      }}
                    >
                      {text}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {covered.length > 0 && (
            <>
              <div
                className="flex items-center gap-3"
                style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}
              >
                <GraduationCap
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: CONTROL_COLOR }}
                />
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: CONTROL_COLOR }}
                >
                  Что войдёт
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {covered.map(l => (
                  <li key={l.id} className="flex gap-2.5">
                    <span
                      className="flex-shrink-0 font-extrabold tabular-nums"
                      style={{
                        fontSize: `${fontSize * 0.8}px`,
                        color: CONTROL_COLOR,
                        marginTop: 2,
                      }}
                    >
                      {l.planNumber}
                    </span>
                    <span
                      className="leading-snug break-words"
                      style={{
                        fontSize: `${fontSize * 0.94}px`,
                        color: 'color-mix(in srgb, var(--c-text) 92%, transparent)',
                      }}
                    >
                      {l.title}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!sections.length && lesson.terms?.length ? (
            <>
              <div
                className="flex items-center gap-3"
                style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}
              >
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: accent }}
                >
                  Термины · {lesson.terms.length}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {lesson.terms.map(term => (
                  <li
                    key={term}
                    className="leading-snug break-words"
                    style={{
                      fontSize: `${fontSize * 0.9}px`,
                      color: 'color-mix(in srgb, var(--c-text) 92%, transparent)',
                    }}
                  >
                    {term}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {lesson.note && (
            <div
              className="leading-relaxed"
              style={{ fontSize: `${fontSize * 0.85}px`, color: 'var(--c-muted)' }}
            >
              {lesson.note}
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

function BlockHeader({
  icon, label, accent,
}: { icon: React.ReactNode; label: string; accent: string }) {
  return (
    <div
      className="flex items-center gap-3"
      style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}
    >
      <span className="flex-shrink-0" style={{ color: accent }}>{icon}</span>
      <span
        className="text-[11px] font-bold uppercase tracking-widest"
        style={{ color: accent }}
      >
        {label}
      </span>
    </div>
  );
}

/** Аннотация методички: абзацы, списки и таблицы как на сайте кафедры. */
function AnnotationView({
  blocks, accent, fontSize,
}: { blocks: AnnotationBlock[]; accent: string; fontSize: number }) {
  const bodyColor = 'color-mix(in srgb, var(--c-text) 92%, transparent)';
  return (
    <>
      <BlockHeader icon={<BookOpen className="w-4 h-4" />} label="Аннотация" accent={accent} />
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
                  style={{ fontSize: `${fontSize * 0.82}px`, color: bodyColor }}
                >
                  {body.length > 0 && (
                    <thead>
                      <tr style={{ background: 'var(--c-card)' }}>
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
                <span className="flex-shrink-0" style={{ color: accent, marginTop: 1 }}>•</span>
                <span
                  className="leading-relaxed break-words"
                  style={{ fontSize: `${fontSize * 0.94}px`, color: bodyColor }}
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
              style={{ fontSize: `${fontSize}px`, color: bodyColor }}
            >
              {b.text}
            </p>
          );
        })}
      </div>
    </>
  );
}

/** Сворачиваемый блок: вопросов и тестов в методичке десятки. */
function CollapsibleBlock({
  icon, label, count, accent, children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-3 w-full text-left active:opacity-70 transition-opacity"
        style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}
        aria-expanded={open}
      >
        <span className="flex-shrink-0" style={{ color: accent }}>{icon}</span>
        <span
          className="flex-1 text-[11px] font-bold uppercase tracking-widest"
          style={{ color: accent }}
        >
          {label} · {count}
        </span>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 transition-transform"
          style={{ color: 'var(--c-muted)', transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {open && children}
    </>
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
            <span
              className="flex-shrink-0 font-extrabold tabular-nums"
              style={{ fontSize: `${fontSize * 0.8}px`, color: accent, marginTop: 2 }}
            >
              {i + 1}
            </span>
            <span
              className="leading-snug break-words"
              style={{
                fontSize: `${fontSize * 0.94}px`,
                color: 'color-mix(in srgb, var(--c-text) 92%, transparent)',
              }}
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
          <li key={i} className="flex flex-col gap-1.5">
            <div className="flex gap-2.5">
              <span
                className="flex-shrink-0 font-extrabold tabular-nums"
                style={{ fontSize: `${fontSize * 0.8}px`, color: accent, marginTop: 2 }}
              >
                {i + 1}
              </span>
              <span
                className="leading-snug font-semibold break-words"
                style={{ fontSize: `${fontSize * 0.92}px`, color: 'var(--c-text)' }}
              >
                {t.question}
              </span>
            </div>
            <ul className="flex flex-col gap-1 pl-6">
              {t.options.map((o, oi) => (
                <li
                  key={oi}
                  className="flex gap-2 leading-snug break-words"
                  style={{
                    fontSize: `${fontSize * 0.88}px`,
                    color: 'color-mix(in srgb, var(--c-text) 88%, transparent)',
                  }}
                >
                  <span className="flex-shrink-0 tabular-nums" style={{ color: 'var(--c-muted)' }}>
                    {oi + 1})
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
  accent,
  fontSize,
  onZoom,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  section: LessonSection;
  index: number;
  accent: string;
  fontSize: number;
  onZoom: (list: string[], idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4 flex flex-col gap-3"
      style={{
        background: 'var(--c-card)',
        border: `1px solid color-mix(in srgb, ${accent} 35%, var(--c-border))`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="flex-shrink-0 font-extrabold tabular-nums"
          style={{ fontSize: `${fontSize * 0.8}px`, color: accent, marginTop: 2 }}
        >
          {index}
        </span>
        <h3
          className="flex-1 font-semibold leading-snug"
          style={{ fontSize: `${fontSize * 1.02}px`, color: 'var(--c-text)' }}
        >
          {section.title}
        </h3>
      </div>

      <div
        className="leading-relaxed break-words"
        style={{
          fontSize: `${fontSize * 0.94}px`,
          color: 'color-mix(in srgb, var(--c-text) 90%, transparent)',
        }}
      >
        {section.text}
      </div>

      <ReadingImages images={section.images} onZoom={onZoom} />

      {section.atlas ? <TermAtlas atlasId={section.atlas} accent={accent} /> : null}

      {section.terms?.length ? (
        <div
          className="flex flex-col gap-1.5 pt-2.5"
          style={{ borderTop: '1px solid var(--c-border)' }}
        >
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: accent }}
          >
            Латынь · {section.terms.length}
          </span>
          {section.terms.map(term => {
            const { ru, la } = splitTerm(term);
            return (
              <div key={term} className="flex flex-col gap-0.5">
                <span
                  className="leading-snug break-words"
                  style={{
                    fontSize: `${fontSize * 0.88}px`,
                    color: 'color-mix(in srgb, var(--c-text) 90%, transparent)',
                  }}
                >
                  {ru}
                </span>
                {la && (
                  <span
                    className="leading-snug break-words italic"
                    style={{
                      fontSize: `${fontSize * 0.84}px`,
                      color: accent,
                    }}
                  >
                    {la}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full disabled:opacity-30 active:scale-95 transition-transform duration-150"
          style={{ color: accent, border: `1px solid ${accent}` }}
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full disabled:opacity-30 active:scale-95 transition-transform duration-150"
          style={{
            background: hasNext ? accent : 'transparent',
            color: hasNext ? '#fff' : 'var(--c-muted)',
            border: `1px solid ${hasNext ? accent : 'var(--c-border)'}`,
          }}
        >
          Дальше →
        </button>
      </div>
    </div>
  );
}

// ─── Список ────────────────────────────────────────────────────────────────

function LessonRow({
  lesson,
  accent,
  isDone,
  onOpen,
  onToggleDone,
}: {
  lesson: Lesson;
  accent: string;
  isDone: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}) {
  const isControl = lesson.kind !== 'lesson';
  const badgeColor = isControl ? CONTROL_COLOR : accent;

  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5"
      style={{
        background: 'var(--c-card)',
        border: `1px solid ${isControl
          ? `color-mix(in srgb, ${CONTROL_COLOR} 40%, var(--c-border))`
          : 'var(--c-border)'}`,
        opacity: isDone ? 0.7 : 1,
      }}
    >
      <button
        type="button"
        onClick={onToggleDone}
        className="flex-shrink-0 active:scale-90 transition-transform duration-150"
        aria-label={isDone ? 'Снять отметку' : 'Отметить как пройденное'}
        style={{ color: isDone ? accent : 'var(--c-muted)' }}
      >
        {isDone
          ? <CheckCircle2 className="w-[22px] h-[22px]" />
          : <Circle className="w-[22px] h-[22px]" />}
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex-1 flex items-center gap-2.5 text-left min-w-0 active:scale-[0.98] transition-transform duration-150"
      >
        <span
          className="flex-shrink-0 text-[12px] font-extrabold tabular-nums w-7 text-center"
          style={{ color: badgeColor }}
        >
          {lesson.planNumber ?? lesson.order}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block text-[13.5px] font-semibold leading-snug"
            style={{
              color: 'var(--c-text)',
              textDecoration: isDone ? 'line-through' : undefined,
            }}
          >
            {lesson.title}
          </span>
          {isControl ? (
            <span
              className="inline-block text-[10.5px] font-bold mt-1 px-1.5 py-0.5 rounded"
              style={{
                background: `color-mix(in srgb, ${CONTROL_COLOR} 16%, transparent)`,
                color: CONTROL_COLOR,
              }}
            >
              {KIND_LABELS[lesson.kind]}
              {lesson.covers?.length ? ` · темы ${formatCovers(lesson.covers)}` : ''}
            </span>
          ) : lesson.sections?.length ? (
            <span
              className="block text-[10.5px] mt-0.5"
              style={{ color: 'var(--c-muted)' }}
            >
              {lesson.sections.length} {pluralSections(lesson.sections.length)}
            </span>
          ) : null}
        </span>
        <ChevronRight
          className="w-4 h-4 flex-shrink-0"
          style={{ color: 'var(--c-muted)' }}
        />
      </button>
    </div>
  );
}

function LecturesBlock({ lectures }: { lectures: Lecture[] }) {
  return (
    <div
      className="rounded-2xl mt-2 px-3 py-3 flex flex-col gap-2.5"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <span className="text-[13px] font-semibold" style={{ color: 'var(--c-text)' }}>
        Лекции курса
        <span className="font-medium ml-1.5" style={{ color: 'var(--c-muted)' }}>
          {lectures.length}
        </span>
      </span>
      {lectures.map(lec => (
        <div key={lec.id} className="flex gap-2">
          <span
            className="flex-shrink-0 text-[11px] font-extrabold tabular-nums mt-[3px] w-5"
            style={{ color: 'var(--c-muted)' }}
          >
            {lec.planNumber ?? lec.order}
          </span>
          <span className="flex-1">
            <span
              className="block text-[12.5px] font-semibold leading-snug"
              style={{ color: 'var(--c-text)' }}
            >
              {lec.title}
            </span>
            {lec.summary && (
              <span
                className="block text-[11.5px] leading-snug mt-1"
                style={{ color: 'var(--c-muted)' }}
              >
                {lec.summary}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-3">
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

function pluralSections(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'подтема';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'подтемы';
  return 'подтем';
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
