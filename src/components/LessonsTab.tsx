"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, Circle,
  GraduationCap, Target,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Lecture, Lesson, LessonKind } from '@/lib/curriculum';

// Локальная копия подписей: импорт значения из curriculum притащил бы в
// клиентский бандл все планы кафедр из файлов.
const KIND_LABELS: Record<LessonKind, string> = {
  lesson: 'Занятие',
  control: 'Контрольная',
  colloquium: 'Коллоквиум',
};

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

function doneStorageKey(programId: string): string {
  return `lessons_done:${programId}`;
}

function readDone(programId: string): Set<string> {
  try {
    const raw = localStorage.getItem(doneStorageKey(programId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export const LessonsTab = ({ onOpenProfile }: { onOpenProfile?: () => void }) => {
  const [programs, setPrograms] = useState<StudentProgram[]>([]);
  const [studyGroup, setStudyGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeProgramId, setActiveProgramId] = useState<string | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (programs.length === 0) {
      setActiveProgramId(null);
      return;
    }
    setActiveProgramId(prev => (
      prev && programs.some(p => p.id === prev) ? prev : programs[0].id
    ));
  }, [programs]);

  const program = useMemo(
    () => programs.find(p => p.id === activeProgramId) ?? null,
    [programs, activeProgramId],
  );

  useEffect(() => {
    setDone(program ? readDone(program.id) : new Set());
    setOpenLessonId(null);
  }, [program]);

  const toggleDone = useCallback((lessonId: string) => {
    if (!program) return;
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      try {
        localStorage.setItem(doneStorageKey(program.id), JSON.stringify([...next]));
      } catch { /* приватный режим — прогресс просто не сохранится */ }
      return next;
    });
  }, [program]);

  const openLesson = useMemo(
    () => program?.lessons.find(l => l.id === openLessonId) ?? null,
    [program, openLessonId],
  );

  if (loading) {
    return (
      <EmptyState
        icon={<CalendarDays className="w-7 h-7" />}
        title="Загружаем расписание"
        text="Секунду — смотрим, какие занятия у твоей группы."
      />
    );
  }

  if (failed) {
    return (
      <EmptyState
        icon={<CalendarDays className="w-7 h-7" />}
        title="Не удалось загрузить занятия"
        text="Проверь связь и попробуй ещё раз."
        action={{ label: 'Повторить', onClick: () => void load() }}
      />
    );
  }

  if (!studyGroup) {
    return (
      <EmptyState
        icon={<CalendarDays className="w-7 h-7" />}
        title="Сначала укажи группу"
        text="Занятия приходят из плана кафедры для конкретной группы. Как только группа будет указана, здесь появится твой семестр."
        action={onOpenProfile ? { label: 'В профиль', onClick: onOpenProfile } : undefined}
      />
    );
  }

  if (!program) {
    return (
      <EmptyState
        icon={<CalendarDays className="w-7 h-7" />}
        title={`Для группы ${studyGroup} занятий пока нет`}
        text="План кафедры ещё не выдан этой группе. Он появится здесь сразу после того, как его откроют."
        action={{ label: 'Обновить', onClick: () => void load() }}
      />
    );
  }

  const lessonsTotal = program.lessons.filter(l => l.kind === 'lesson').length;
  const doneCount = program.lessons.filter(l => done.has(l.id)).length;

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="wait" initial={false}>
        {openLesson ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col h-full"
          >
            <LessonDetail
              lesson={openLesson}
              program={program}
              isDone={done.has(openLesson.id)}
              onToggleDone={() => toggleDone(openLesson.id)}
              onBack={() => setOpenLessonId(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col h-full"
          >
            {/* Шапка */}
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
              <div
                className="text-[12px] mt-1 leading-snug"
                style={{ color: 'var(--c-muted)' }}
              >
                {program.title}
              </div>

              {programs.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {programs.map(p => {
                    const active = p.id === program.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActiveProgramId(p.id)}
                        className="text-[12px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                        style={{
                          background: active
                            ? `color-mix(in srgb, ${p.subjectColor} 18%, transparent)`
                            : 'var(--c-card)',
                          color: active ? p.subjectColor : 'var(--c-muted)',
                          border: `1px solid ${active ? p.subjectColor : 'var(--c-border)'}`,
                        }}
                      >
                        {p.subjectLabel}
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
                      width: `${program.lessons.length
                        ? (doneCount / program.lessons.length) * 100
                        : 0}%`,
                      background: program.subjectColor,
                    }}
                  />
                </div>
                <span className="tabular-nums">{doneCount} из {program.lessons.length}</span>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="px-4 py-3 flex flex-col gap-2 pb-28">
                {program.lessons.map(lesson => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    accent={program.subjectColor}
                    isDone={done.has(lesson.id)}
                    onOpen={() => setOpenLessonId(lesson.id)}
                    onToggleDone={() => toggleDone(lesson.id)}
                  />
                ))}

                {program.lectures.length > 0 && (
                  <LecturesBlock lectures={program.lectures} />
                )}

                <div
                  className="text-[11px] leading-relaxed mt-2 px-1"
                  style={{ color: 'var(--c-muted)' }}
                >
                  {lessonsTotal} практических занятий и{' '}
                  {program.lessons.length - lessonsTotal} контрольных точек.
                  {program.sourceDoc ? ` Источник: ${program.sourceDoc}.` : ''}
                </div>
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

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
  const badgeColor = isControl ? '#B4801F' : accent;

  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5"
      style={{
        background: 'var(--c-card)',
        border: `1px solid ${isControl
          ? 'color-mix(in srgb, #B4801F 40%, var(--c-border))'
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
          {isControl && (
            <span
              className="inline-block text-[10.5px] font-bold mt-1 px-1.5 py-0.5 rounded"
              style={{
                background: 'color-mix(in srgb, #B4801F 16%, transparent)',
                color: '#B4801F',
              }}
            >
              {KIND_LABELS[lesson.kind]}
              {lesson.covers?.length ? ` · темы ${formatCovers(lesson.covers)}` : ''}
            </span>
          )}
        </span>
        <ChevronRight
          className="w-4 h-4 flex-shrink-0"
          style={{ color: 'var(--c-muted)' }}
        />
      </button>
    </div>
  );
}

function LessonDetail({
  lesson,
  program,
  isDone,
  onToggleDone,
  onBack,
}: {
  lesson: Lesson;
  program: StudentProgram;
  isDone: boolean;
  onToggleDone: () => void;
  onBack: () => void;
}) {
  const isControl = lesson.kind !== 'lesson';
  const coveredLessons = useMemo(() => {
    if (!lesson.covers?.length) return [];
    const set = new Set(lesson.covers);
    return program.lessons.filter(l => l.planNumber && set.has(l.planNumber));
  }, [lesson.covers, program.lessons]);

  return (
    <>
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 py-3"
        style={{ borderBottom: '1px solid var(--c-border)' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-full"
          style={{ color: 'var(--c-muted)' }}
          aria-label="Назад к списку"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span
          className="text-[12.5px] font-semibold flex-1 truncate"
          style={{ color: 'var(--c-muted)' }}
        >
          {isControl ? KIND_LABELS[lesson.kind] : 'Занятие'}
          {lesson.planNumber ? ` · тема ${lesson.planNumber}` : ''}
          {lesson.hours ? ` · ${lesson.hours} ч` : ''}
        </span>
        <button
          type="button"
          onClick={onToggleDone}
          className="text-[12px] font-bold px-2.5 py-1.5 rounded-full"
          style={{
            background: isDone
              ? `color-mix(in srgb, ${program.subjectColor} 16%, transparent)`
              : 'var(--c-card)',
            color: isDone ? program.subjectColor : 'var(--c-muted)',
            border: `1px solid ${isDone ? program.subjectColor : 'var(--c-border)'}`,
          }}
        >
          {isDone ? 'Пройдено' : 'Отметить'}
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-4 pb-28 flex flex-col gap-4">
          <h2
            className="text-[18px] font-bold leading-snug"
            style={{ color: 'var(--c-text)' }}
          >
            {lesson.title}
          </h2>

          {lesson.summary && (
            <p
              className="text-[14px] leading-relaxed"
              style={{ color: 'var(--c-text)' }}
            >
              {lesson.summary}
            </p>
          )}

          {lesson.objectives?.length ? (
            <section
              className="rounded-2xl p-3.5"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-border)',
              }}
            >
              <div className="flex items-center gap-1.5 mb-2.5">
                <Target
                  className="w-[15px] h-[15px]"
                  style={{ color: program.subjectColor }}
                />
                <span
                  className="text-[12.5px] font-bold"
                  style={{ color: 'var(--c-text)' }}
                >
                  Что уметь к паре
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {lesson.objectives.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className="flex-shrink-0 text-[11px] font-extrabold tabular-nums mt-[3px]"
                      style={{ color: program.subjectColor }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="text-[13px] leading-snug"
                      style={{ color: 'var(--c-text)' }}
                    >
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {coveredLessons.length > 0 && (
            <section
              className="rounded-2xl p-3.5"
              style={{
                background: 'color-mix(in srgb, #B4801F 8%, var(--c-card))',
                border: '1px solid color-mix(in srgb, #B4801F 35%, var(--c-border))',
              }}
            >
              <div className="flex items-center gap-1.5 mb-2.5">
                <GraduationCap className="w-[15px] h-[15px]" style={{ color: '#B4801F' }} />
                <span className="text-[12.5px] font-bold" style={{ color: 'var(--c-text)' }}>
                  Что войдёт
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {coveredLessons.map(l => (
                  <li key={l.id} className="flex gap-2">
                    <span
                      className="flex-shrink-0 text-[11px] font-extrabold tabular-nums mt-[2px]"
                      style={{ color: '#B4801F' }}
                    >
                      {l.planNumber}
                    </span>
                    <span
                      className="text-[12.5px] leading-snug"
                      style={{ color: 'var(--c-text)' }}
                    >
                      {l.title}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lesson.terms?.length ? (
            <section>
              <div
                className="text-[12.5px] font-bold mb-2"
                style={{ color: 'var(--c-text)' }}
              >
                Термины занятия
                <span className="font-medium ml-1.5" style={{ color: 'var(--c-muted)' }}>
                  {lesson.terms.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lesson.terms.map(term => (
                  <span
                    key={term}
                    className="text-[12px] px-2.5 py-1 rounded-full"
                    style={{
                      background: 'var(--c-card)',
                      border: '1px solid var(--c-border)',
                      color: 'var(--c-text)',
                    }}
                  >
                    {term}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {lesson.note && (
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--c-muted)' }}>
              {lesson.note}
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  );
}

function LecturesBlock({ lectures }: { lectures: Lecture[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-2xl overflow-hidden mt-2"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--c-text)' }}>
          Лекции семестра
          <span className="font-medium ml-1.5" style={{ color: 'var(--c-muted)' }}>
            {lectures.length}
          </span>
        </span>
        <ChevronRight
          className="w-4 h-4 transition-transform"
          style={{
            color: 'var(--c-muted)',
            transform: open ? 'rotate(90deg)' : undefined,
          }}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
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
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center gap-3">
      <div style={{ color: 'var(--c-muted)' }}>{icon}</div>
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
          style={{
            background: 'var(--c-primary)',
            color: 'var(--c-bg)',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** [31,32,33,34] → «31–34», [31,33] → «31, 33» */
function formatCovers(covers: number[]): string {
  const sorted = [...covers].sort((a, b) => a - b);
  const isRange = sorted.length > 2
    && sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return isRange
    ? `${sorted[0]}–${sorted[sorted.length - 1]}`
    : sorted.join(', ');
}
