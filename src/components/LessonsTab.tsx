"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronRight,
  Circle, GraduationCap, Target, X,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Lecture, Lesson, LessonKind, LessonLink, LessonSection } from '@/lib/curriculum';
import { ReadingImages, useImageZoom } from '@/components/ImageZoom';
import { DepartmentSheet } from '@/components/DepartmentSheet';
import { getDepartment } from '@/lib/departments';
import { openExternalUrl } from '@/lib/openExternalUrl';

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
interface FlatLesson {
  lesson: Lesson;
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
        items.push({ lesson, course: p.course, semester: lesson.semester });
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

export const LessonsTab = ({ onOpenProfile }: { onOpenProfile?: () => void }) => {
  const [programs, setPrograms] = useState<StudentProgram[]>([]);
  const [studyGroup, setStudyGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [showDepartment, setShowDepartment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const tgId = localStorage.getItem('user_tg_id') || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initData = (window as any).Telegram?.WebApp?.initData || '';
      const r = await fetch('/api/curriculum', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, initData }),
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
  }, []);

  useEffect(() => { void load(); }, [load]);

  const subjects = useMemo(() => buildSubjectViews(programs), [programs]);

  useEffect(() => {
    if (subjects.length === 0) {
      setActiveSubjectId(null);
      return;
    }
    setActiveSubjectId(prev => (
      prev && subjects.some(s => s.subjectId === prev) ? prev : subjects[0].subjectId
    ));
  }, [subjects]);

  const view = useMemo(
    () => subjects.find(s => s.subjectId === activeSubjectId) ?? null,
    [subjects, activeSubjectId],
  );

  useEffect(() => {
    setDone(view ? readDone(view.subjectId) : new Set());
    setReadingId(null);
    setShowDepartment(false);
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
  const reading = readingIndex >= 0 && view ? view.items[readingIndex] : null;

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
  const department = getDepartment(view.subjectId);

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

        {subjects.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {subjects.map(s => {
              const active = s.subjectId === view.subjectId;
              return (
                <button
                  key={s.subjectId}
                  type="button"
                  onClick={() => setActiveSubjectId(s.subjectId)}
                  className="text-[12px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    background: active
                      ? `color-mix(in srgb, ${s.color} 18%, transparent)`
                      : 'var(--c-card)',
                    color: active ? s.color : 'var(--c-muted)',
                    border: `1px solid ${active ? s.color : 'var(--c-border)'}`,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

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
          {department && (
            <button
              type="button"
              onClick={() => setShowDepartment(true)}
              className="rounded-2xl px-3.5 py-3 flex items-center gap-3 text-left mb-1 transition-all active:scale-[0.99]"
              style={{
                background: `color-mix(in srgb, ${view.color} 10%, var(--c-card))`,
                border: `1px solid color-mix(in srgb, ${view.color} 32%, var(--c-border))`,
              }}
            >
              <span
                className="w-10 h-10 rounded-[11px] flex items-center justify-center text-[18px] flex-shrink-0"
                style={{ background: `color-mix(in srgb, ${view.color} 16%, transparent)` }}
              >
                🏛️
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-bold leading-snug" style={{ color: 'var(--c-text)' }}>
                  {department.name}
                </span>
                <span className="block text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--c-muted)' }}>
                  Кто преподаёт, куда идти и что скачать
                </span>
              </span>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: view.color }} />
            </button>
          )}
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
            onToggleDone={() => toggleDone(reading.lesson.id)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onClose={() => setReadingId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDepartment && department && (
          <DepartmentSheet
            department={department}
            accentColor={view.color}
            onClose={() => setShowDepartment(false)}
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

function SectionLinks({ links, accent }: { links: LessonLink[]; accent: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {links.map(link => (
        <button
          key={link.url}
          type="button"
          onClick={() => openExternalUrl(link.url)}
          className="w-full text-left text-[13px] font-semibold px-3 py-2.5 rounded-xl transition-all active:scale-[0.98]"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
            border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
          }}
        >
          {link.label}
        </button>
      ))}
    </div>
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
        className="leading-relaxed break-words whitespace-pre-wrap"
        style={{
          fontSize: `${fontSize * 0.94}px`,
          color: 'color-mix(in srgb, var(--c-text) 90%, transparent)',
        }}
      >
        {section.text}
      </div>

      {section.links?.length ? <SectionLinks links={section.links} accent={accent} /> : null}

      <ReadingImages images={section.images} onZoom={onZoom} />

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
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full disabled:opacity-30"
          style={{ color: accent, border: `1px solid ${accent}` }}
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-full disabled:opacity-30"
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
        className="flex-shrink-0"
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
        className="flex-1 flex items-center gap-2.5 text-left min-w-0"
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
          className="mt-1 text-[13px] font-bold px-4 py-2 rounded-full"
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

/** Локальный предпросмотр нового чтения — без Telegram и API. */
export function LessonsDesignPreview({ firstLesson }: { firstLesson?: Lesson }) {
  const [mode, setMode] = useState<'heart' | 'first' | 'department' | null>(
    firstLesson ? 'first' : 'heart',
  );
  const anatColor = 'hsl(0 75% 55%)';
  const department = getDepartment('anat');
  const firstItem: FlatLesson | null = firstLesson
    ? { course: 1, semester: firstLesson.semester, lesson: firstLesson }
    : null;
  const demo: FlatLesson = {
    course: 2,
    semester: 3,
    lesson: {
      id: 'preview_l50',
      order: 50,
      planNumber: 50,
      semester: 3,
      kind: 'lesson',
      hours: 3,
      title: 'Сердце. Ветви грудного отдела аорты',
      summary: 'Строение сердца: камеры, клапаны, проводящая система. Перикард. Аорта и её ветви. Возрастные особенности у детей.',
      objectives: [
        'Показать на препарате все четыре клапана',
        'Назвать ветви дуги аорты справа налево',
      ],
      sections: [
        {
          id: 's1',
          title: 'Строение сердца',
          text: 'Сердце — полый мышечный орган в среднем средостении, 2/3 левее срединной линии. Четыре камеры: правое и левое предсердие, правый и левый желудочек. У детей раннего возраста правый желудочек относительно более развит.',
          images: ['/images/bio/tasks-ped/task-102.png', '/images/bio/tasks-ped/task-103.png'],
          terms: [
            'Правое предсердие — atrium dextrum',
            'Левый желудочек — ventriculus sinister',
            'Митральный клапан — valva mitralis',
          ],
        },
        {
          id: 's2',
          title: 'Проводящая система сердца',
          text: 'Синусовый узел в правом предсердии задаёт ритм 60–80 раз в минуту. Дальше импульс идёт в атриовентрикулярный узел, пучок Гиса и волокна Пуркинье. У новорождённых ЧСС 120–160.',
          images: ['/images/bio/tasks-ped/task-107.png'],
          terms: [
            'Синусовый узел — nodus sinuatrialis',
            'Пучок Гиса — fasciculus atrioventricularis',
          ],
        },
        {
          id: 's3',
          title: 'Аорта. Ветви грудного отдела',
          text: 'Восходящая аорта даёт венечные артерии. Дуга — три ветви: плечеголовной ствол, левая общая сонная, левая подключичная. Артериальный проток закрывается в первые дни жизни.',
          terms: [
            'Дуга аорты — arcus aortae',
            'Артериальный проток — ductus arteriosus',
          ],
        },
      ],
    },
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--c-bg)', color: 'var(--c-text)' }}>
      <div className="max-w-md mx-auto min-h-screen flex flex-col px-4 pt-6 pb-10">
        <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--c-muted)' }}>
          Предпросмотр · Занятия
        </div>
        <div className="flex flex-col gap-2">
          {firstLesson && (
            <button
              type="button"
              onClick={() => setMode('first')}
              className="rounded-2xl px-3.5 py-3 flex items-center gap-3 text-left"
              style={{ background: 'var(--c-card)', border: `1px solid color-mix(in srgb, ${anatColor} 32%, var(--c-border))` }}
            >
              <span className="text-[12px] font-extrabold tabular-nums w-7 text-center" style={{ color: anatColor }}>1</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-semibold">Первое занятие · как учить</span>
                <span className="block text-[11px] mt-0.5" style={{ color: 'var(--c-muted)' }}>Anatomy Learning и введение</span>
              </span>
            </button>
          )}
          {department && (
            <button
              type="button"
              onClick={() => setMode('department')}
              className="rounded-2xl px-3.5 py-3 flex items-center gap-3 text-left"
              style={{ background: `color-mix(in srgb, ${anatColor} 10%, var(--c-card))`, border: `1px solid color-mix(in srgb, ${anatColor} 32%, var(--c-border))` }}
            >
              <span className="text-[18px]">🏛️</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-bold">{department.name}</span>
                <span className="block text-[11px] mt-0.5" style={{ color: 'var(--c-muted)' }}>Кто преподаёт, куда идти и что скачать</span>
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode('heart')}
            className="rounded-2xl px-3 py-2.5 flex items-center gap-2.5 text-left"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
          >
            <span className="text-[12px] font-extrabold tabular-nums w-7 text-center" style={{ color: 'hsl(210 90% 58%)' }}>50</span>
            <span className="flex-1 text-[13.5px] font-semibold">Сердце. Ветви грудного отдела аорты</span>
          </button>
        </div>
      </div>
      {mode === 'heart' && (
        <ReadingView
          item={demo}
          accent="hsl(210 90% 58%)"
          subjectLabel="Анатомия"
          allItems={[demo]}
          isDone={false}
          onToggleDone={() => undefined}
          onPrev={() => undefined}
          onNext={() => undefined}
          onClose={() => setMode(null)}
        />
      )}
      {mode === 'first' && firstItem && (
        <ReadingView
          item={firstItem}
          accent={anatColor}
          subjectLabel="Анатомия"
          allItems={[firstItem]}
          isDone={false}
          onToggleDone={() => undefined}
          onPrev={() => undefined}
          onNext={() => undefined}
          onClose={() => setMode(null)}
        />
      )}
      {mode === 'department' && department && (
        <DepartmentSheet
          department={department}
          accentColor={anatColor}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
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
