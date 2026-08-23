"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, User, Check,
  Plus, X, Loader2, GraduationCap, BookOpen, Users, Search, Trash2,
  AlertCircle, RefreshCw,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppBrandIcon } from '@/components/AppBrandIcon';
import { APP_BRAND_NAME } from '@/lib/subjects';
import {
  CONTROL_FORM_COLOR,
  CONTROL_FORM_LABELS,
  disciplineTotalHours,
  semesterProgressPct,
  type CurriculumDiscipline,
  type CurriculumSemester,
} from '@/lib/curriculum';
import {
  LESSON_KIND_COLOR,
  LESSON_KIND_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  addDays,
  formatDateHuman,
  krskDateKey,
  krskTimeKey,
  mondayOf,
  type ScheduleDay,
  type ScheduleOccurrence,
  type PersonalSchedule,
} from '@/lib/schedule';
import {
  addPersonalLesson,
  fetchSchedule,
  removePersonalLesson,
  setLessonHidden,
  setLessonNote,
  setScheduleSubgroup,
  saveStudyGroupFromSchedule,
  toggleLessonDone,
  type ScheduleResponse,
} from '@/lib/scheduleApi';
import { buildStudyGroupFromDigits } from '@/lib/studyGroup';
import { useToast } from '@/hooks/use-toast';

type ScheduleView = 'today' | 'week' | 'plan';

const VIEW_TABS: { id: ScheduleView; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'week',  label: 'Неделя' },
  { id: 'plan',  label: 'План курса' },
];

const REFRESH_INTERVAL_MS = 5 * 60_000;

function minutesUntil(startHHMM: string, nowHHMM: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(startHHMM) || !/^\d{2}:\d{2}$/.test(nowHHMM)) return null;
  const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  return toMin(startHHMM) - toMin(nowHHMM);
}

function humanCountdown(minutes: number): string {
  if (minutes <= 0) return 'идёт сейчас';
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `через ${hours} ч ${rest} мин` : `через ${hours} ч`;
  const days = Math.round(hours / 24);
  return `через ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`;
}

function daysUntilLabel(dateKey: string, todayKey: string): string {
  const diff = Math.round(
    (Date.parse(`${dateKey}T12:00:00Z`) - Date.parse(`${todayKey}T12:00:00Z`)) / 86_400_000,
  );
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff < 0) return 'прошло';
  return `через ${diff} ${diff < 5 ? 'дня' : 'дней'}`;
}

// ─── Мелкие элементы оформления ────────────────────────────────────────────

const Chip: React.FC<{ color?: string; children: React.ReactNode }> = ({ color, children }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[10px] font-bold uppercase tracking-wide"
    style={{
      background: color ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--c-card)',
      color: color ?? 'var(--c-muted)',
      border: `1px solid ${color ? `color-mix(in srgb, ${color} 34%, transparent)` : 'var(--c-border)'}`,
    }}
  >
    {children}
  </span>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2
    className="text-[11px] font-bold uppercase tracking-widest px-1 mb-2"
    style={{ color: 'var(--c-muted)' }}
  >
    {children}
  </h2>
);

const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  text?: string;
  action?: React.ReactNode;
}> = ({ icon, title, text, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
    <div style={{ color: 'var(--c-muted)' }}>{icon ?? <CalendarDays className="w-9 h-9" />}</div>
    <div className="text-[15px] font-bold" style={{ color: 'var(--c-text)' }}>{title}</div>
    {text && (
      <p className="text-[13px] leading-relaxed max-w-xs" style={{ color: 'var(--c-muted)' }}>
        {text}
      </p>
    )}
    {action}
  </div>
);

// ─── Карточка занятия ──────────────────────────────────────────────────────

interface LessonCardProps {
  occurrence: ScheduleOccurrence;
  note?: string;
  done: boolean;
  highlight?: boolean;
  onOpen: (occurrence: ScheduleOccurrence) => void;
}

const LessonCard: React.FC<LessonCardProps> = ({ occurrence, note, done, highlight, onOpen }) => {
  const { lesson } = occurrence;
  const color = LESSON_KIND_COLOR[lesson.kind];

  return (
    <button
      type="button"
      onClick={() => onOpen(occurrence)}
      className="w-full text-left rounded-2xl p-3 flex gap-3 transition-all active:scale-[0.99]"
      style={{
        background: highlight
          ? `color-mix(in srgb, ${color} 12%, var(--c-card))`
          : 'var(--c-card)',
        border: `1px solid ${highlight ? `color-mix(in srgb, ${color} 40%, transparent)` : 'var(--c-border)'}`,
        opacity: occurrence.cancelled ? 0.55 : 1,
      }}
    >
      <div className="flex flex-col items-center flex-shrink-0 w-[52px] pt-0.5">
        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--c-text)' }}>
          {occurrence.start || '—'}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--c-muted)' }}>
          {occurrence.end}
        </span>
        <span
          className="mt-1.5 w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span
            className="text-[14px] font-bold leading-snug flex-1 min-w-0"
            style={{
              color: 'var(--c-text)',
              textDecoration: occurrence.cancelled ? 'line-through' : undefined,
            }}
          >
            {lesson.title}
          </span>
          {done && (
            <span
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
            >
              <Check className="w-3 h-3" strokeWidth={3} />
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <Chip color={color}>{LESSON_KIND_LABELS[lesson.kind]}</Chip>
          {lesson.subgroup && <Chip>{lesson.subgroup} подгруппа</Chip>}
          {occurrence.source === 'personal' && <Chip color="var(--c-primary)">Своё</Chip>}
          {occurrence.replaced && <Chip color="hsl(39 82% 43%)">Замена</Chip>}
          {occurrence.cancelled && <Chip color="hsl(0 75% 55%)">Отменена</Chip>}
        </div>

        {(lesson.room || lesson.teacher) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[12px]" style={{ color: 'var(--c-muted)' }}>
            {lesson.room && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {lesson.room}{lesson.building ? `, ${lesson.building}` : ''}
              </span>
            )}
            {lesson.teacher && (
              <span className="inline-flex items-center gap-1 truncate">
                <User className="w-3 h-3" />
                {lesson.teacher}
              </span>
            )}
          </div>
        )}

        {occurrence.changeNote && (
          <p className="mt-1.5 text-[12px]" style={{ color: 'hsl(39 82% 43%)' }}>
            {occurrence.changeNote}
          </p>
        )}
        {note && (
          <p
            className="mt-1.5 text-[12px] rounded-lg px-2 py-1"
            style={{ background: 'var(--c-bg)', color: 'var(--c-text)' }}
          >
            {note}
          </p>
        )}
      </div>
    </button>
  );
};

// ─── Шторка занятия ────────────────────────────────────────────────────────

interface LessonSheetProps {
  occurrence: ScheduleOccurrence;
  note: string;
  done: boolean;
  canEdit: boolean;
  subjectAvailable: boolean;
  onClose: () => void;
  onSaveNote: (note: string) => Promise<void>;
  onToggleDone: () => Promise<void>;
  onHide: () => Promise<void>;
  onRemoveExtra?: () => Promise<void>;
  onOpenSubject?: (subjectId: string) => void;
}

const LessonSheet: React.FC<LessonSheetProps> = ({
  occurrence, note, done, canEdit, subjectAvailable,
  onClose, onSaveNote, onToggleDone, onHide, onRemoveExtra, onOpenSubject,
}) => {
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { lesson } = occurrence;
  const color = LESSON_KIND_COLOR[lesson.kind];

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveNote(draft.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

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
        style={{ background: 'var(--c-card)', borderTop: '1px solid var(--c-border)', maxHeight: '88vh' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--c-border)' }} />
        </div>

        <div className="px-5 pb-5 overflow-y-auto overscroll-contain">
          <div className="flex items-start gap-2">
            <h3 className="text-[18px] font-bold leading-tight flex-1" style={{ color: 'var(--c-text)' }}>
              {lesson.title}
            </h3>
            <button type="button" onClick={onClose} style={{ color: 'var(--c-muted)' }}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <Chip color={color}>{LESSON_KIND_LABELS[lesson.kind]}</Chip>
            <Chip>{WEEKDAY_LABELS[occurrence.weekday]}, {formatDateHuman(occurrence.date)}</Chip>
            <Chip>{occurrence.pair} пара</Chip>
          </div>

          <div className="mt-4 space-y-2 text-[13px]" style={{ color: 'var(--c-text)' }}>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" style={{ color: 'var(--c-muted)' }} />
              {occurrence.start && occurrence.end ? `${occurrence.start} — ${occurrence.end}` : 'Время не указано'}
            </div>
            {lesson.room && (
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" style={{ color: 'var(--c-muted)' }} />
                {lesson.room}{lesson.building ? `, ${lesson.building}` : ''}
              </div>
            )}
            {lesson.teacher && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" style={{ color: 'var(--c-muted)' }} />
                {lesson.teacher}
              </div>
            )}
          </div>

          {lesson.note && (
            <p
              className="mt-3 text-[13px] leading-relaxed rounded-xl p-3"
              style={{ background: 'var(--c-bg)', color: 'var(--c-muted)' }}
            >
              {lesson.note}
            </p>
          )}

          {lesson.subjectId && subjectAvailable && onOpenSubject && (
            <button
              type="button"
              onClick={() => onOpenSubject(lesson.subjectId as string)}
              className="w-full mt-4 h-12 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2"
              style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
            >
              <BookOpen className="w-4 h-4" />
              Открыть материалы предмета
            </button>
          )}

          {canEdit && (
            <>
              <div className="mt-5">
                <SectionTitle>Моя заметка</SectionTitle>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value.slice(0, 400))}
                  placeholder="Что подготовить, какой кабинет, что спросить…"
                  rows={3}
                  className="w-full rounded-xl p-3 text-[13px] resize-none focus:outline-none"
                  style={{
                    background: 'var(--c-bg)',
                    border: '1px solid var(--c-border)',
                    color: 'var(--c-text)',
                    caretColor: 'var(--c-primary)',
                  }}
                />
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 h-11 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2"
                  style={{ background: 'var(--c-primary)', color: 'var(--c-bg)', opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => { void onToggleDone(); onClose(); }}
                  className="flex-1 h-11 rounded-xl text-[13px] font-bold"
                  style={{
                    background: done ? 'var(--c-card)' : 'var(--c-bg)',
                    border: '1px solid var(--c-border)',
                    color: 'var(--c-text)',
                  }}
                >
                  {done ? 'Снять отметку' : 'Готов к паре'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  void (onRemoveExtra ? onRemoveExtra() : onHide());
                  onClose();
                }}
                className="w-full mt-2 h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2"
                style={{ background: 'transparent', color: 'var(--c-muted)' }}
              >
                <Trash2 className="w-4 h-4" />
                {onRemoveExtra ? 'Удалить своё занятие' : 'Скрыть пару из расписания'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

// ─── Форма своего занятия ──────────────────────────────────────────────────

const AddLessonSheet: React.FC<{
  defaultDate: string;
  onClose: () => void;
  onSubmit: (lesson: Record<string, unknown>) => Promise<void>;
}> = ({ defaultDate, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [pair, setPair] = useState(1);
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        onDate: date,
        pair,
        room: room.trim() || undefined,
        kind: 'other',
        weekday: 1,
        weekParity: 'every',
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  const fieldStyle: React.CSSProperties = {
    background: 'var(--c-bg)',
    border: '1px solid var(--c-border)',
    color: 'var(--c-text)',
  };

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
        className="rounded-t-[28px] p-5"
        style={{ background: 'var(--c-card)', borderTop: '1px solid var(--c-border)' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-[17px] font-bold mb-4" style={{ color: 'var(--c-text)' }}>
          Своё занятие
        </h3>

        <div className="space-y-2.5">
          <input
            value={title}
            onChange={e => setTitle(e.target.value.slice(0, 120))}
            placeholder="Название: отработка, кружок, СНО…"
            className="w-full h-11 rounded-xl px-3 text-[13px] focus:outline-none"
            style={fieldStyle}
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="flex-1 h-11 rounded-xl px-3 text-[13px] focus:outline-none"
              style={fieldStyle}
            />
            <select
              value={pair}
              onChange={e => setPair(Number(e.target.value))}
              className="w-[110px] h-11 rounded-xl px-3 text-[13px] focus:outline-none"
              style={fieldStyle}
            >
              {[1, 2, 3, 4, 5, 6, 7].map(n => (
                <option key={n} value={n}>{n} пара</option>
              ))}
            </select>
          </div>
          <input
            value={room}
            onChange={e => setRoom(e.target.value.slice(0, 40))}
            placeholder="Кабинет (необязательно)"
            className="w-full h-11 rounded-xl px-3 text-[13px] focus:outline-none"
            style={fieldStyle}
          />
        </div>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
            className="flex-1 h-12 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2"
            style={{
              background: 'var(--c-primary)',
              color: 'var(--c-bg)',
              opacity: !title.trim() || saving ? 0.5 : 1,
            }}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Добавить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 h-12 rounded-2xl text-[14px] font-semibold"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
          >
            Отмена
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

// ─── Учебный план ──────────────────────────────────────────────────────────

const DisciplineCard: React.FC<{
  discipline: CurriculumDiscipline;
  today: string;
  subjectAvailable: boolean;
  onOpenSubject?: (subjectId: string) => void;
}> = ({ discipline, today, subjectAvailable, onOpenSubject }) => {
  const controlColor = CONTROL_FORM_COLOR[discipline.control];
  const hours = disciplineTotalHours(discipline);

  return (
    <div
      className="rounded-2xl p-3.5"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <div className="flex items-start gap-2">
        <span className="text-[14px] font-bold leading-snug flex-1" style={{ color: 'var(--c-text)' }}>
          {discipline.title}
        </span>
        {discipline.control !== 'none' && (
          <Chip color={controlColor}>{CONTROL_FORM_LABELS[discipline.control]}</Chip>
        )}
      </div>

      {discipline.department && (
        <p className="text-[12px] mt-1" style={{ color: 'var(--c-muted)' }}>
          {discipline.department}
        </p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[12px]" style={{ color: 'var(--c-muted)' }}>
        {!!discipline.hoursLecture && <span>Лекции: {discipline.hoursLecture} ч</span>}
        {!!discipline.hoursPractice && <span>Практика: {discipline.hoursPractice} ч</span>}
        {!!discipline.hoursSelf && <span>Самост.: {discipline.hoursSelf} ч</span>}
        {!!discipline.credits && <span>{discipline.credits} з.е.</span>}
        {!discipline.hoursLecture && !discipline.hoursPractice && hours > 0 && <span>{hours} ч</span>}
      </div>

      {discipline.controlDate && (
        <p className="text-[12px] mt-2 font-semibold" style={{ color: controlColor }}>
          {CONTROL_FORM_LABELS[discipline.control]} · {formatDateHuman(discipline.controlDate)}
          {' · '}{daysUntilLabel(discipline.controlDate, today)}
        </p>
      )}

      {discipline.note && (
        <p className="text-[12px] mt-2 leading-relaxed" style={{ color: 'var(--c-muted)' }}>
          {discipline.note}
        </p>
      )}

      {discipline.subjectId && subjectAvailable && onOpenSubject && (
        <button
          type="button"
          onClick={() => onOpenSubject(discipline.subjectId as string)}
          className="mt-3 w-full h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2"
          style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
        >
          <BookOpen className="w-4 h-4" />
          Готовиться в приложении
        </button>
      )}
      {discipline.subjectId && !subjectAvailable && (
        <p className="mt-2.5 text-[12px]" style={{ color: 'var(--c-muted)' }}>
          Материалы по предмету есть в приложении — доступ пока закрыт.
        </p>
      )}
    </div>
  );
};

// ─── Основной компонент ────────────────────────────────────────────────────

export interface ScheduleTabProps {
  /** Открытые студенту предметы — от них зависит кнопка «Готовиться». */
  availableSubjects?: string[];
  onOpenSubject?: (subjectId: string) => void;
  onSecretTap?: () => void;
}

export const ScheduleTab: React.FC<ScheduleTabProps> = ({
  availableSubjects = [],
  onOpenSubject,
  onSecretTap,
}) => {
  const { toast } = useToast();
  const [view, setView] = useState<ScheduleView>('today');
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(krskDateKey()));
  const [viewGroup, setViewGroup] = useState<{ facultyId: string; studyGroup: string } | null>(null);
  const [openOccurrence, setOpenOccurrence] = useState<ScheduleOccurrence | null>(null);
  const [addingLesson, setAddingLesson] = useState(false);
  const [groupDigits, setGroupDigits] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);
  const [semester, setSemester] = useState<1 | 2 | null>(null);
  const [nowTime, setNowTime] = useState(() => krskTimeKey());
  const reqIdRef = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean; from?: string }) => {
    const reqId = ++reqIdRef.current;
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetchSchedule({
        from: opts?.from ?? weekStart,
        days: 7,
        viewFacultyId: viewGroup?.facultyId,
        viewStudyGroup: viewGroup?.studyGroup,
      });
      if (reqId !== reqIdRef.current) return;
      setData(res);
      setError(null);
      if (semester === null && res.plan?.activeSemester) setSemester(res.plan.activeSemester);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Не удалось загрузить расписание');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [weekStart, viewGroup, semester]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const iv = setInterval(() => {
      setNowTime(krskTimeKey());
      void load({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [load]);

  const personal: PersonalSchedule | null = data?.personal ?? null;
  const canEdit = data?.isOwnGroup !== false;
  const today = data?.today ?? krskDateKey();
  const days: ScheduleDay[] = data?.days ?? [];

  const doneSet = useMemo(() => new Set(personal?.done ?? []), [personal]);
  const notes = personal?.notes ?? {};

  const todayDay = useMemo(
    () => days.find(d => d.date === today) ?? null,
    [days, today],
  );

  const nextOccurrence = useMemo(() => {
    for (const day of days) {
      if (day.date < today) continue;
      for (const occ of day.occurrences) {
        if (occ.cancelled) continue;
        if (day.date === today && occ.end && occ.end <= nowTime) continue;
        return occ;
      }
    }
    return null;
  }, [days, today, nowTime]);

  const activeSemester: CurriculumSemester | null = useMemo(() => {
    const semesters = data?.plan?.semesters ?? [];
    const wanted = semester ?? data?.plan?.activeSemester ?? 1;
    return semesters.find(s => s.semester === wanted) ?? semesters[0] ?? null;
  }, [data, semester]);

  // ── Действия личного слоя ───────────────────────────────────────────────

  const applyPersonal = useCallback((next: PersonalSchedule) => {
    setData(prev => (prev ? { ...prev, personal: next } : prev));
  }, []);

  const guarded = useCallback(async (fn: () => Promise<{ personal: PersonalSchedule }>) => {
    try {
      const res = await fn();
      applyPersonal(res.personal);
      await load({ silent: true });
    } catch (e) {
      toast({
        title: 'Не сохранилось',
        description: e instanceof Error ? e.message : 'Попробуй ещё раз',
      });
    }
  }, [applyPersonal, load, toast]);

  const handleSaveNote = useCallback(async (key: string, note: string) => {
    await guarded(() => setLessonNote(key, note));
  }, [guarded]);

  const handleToggleDone = useCallback(async (key: string) => {
    await guarded(() => toggleLessonDone(key));
  }, [guarded]);

  const handleHide = useCallback(async (key: string) => {
    await guarded(() => setLessonHidden(key, true));
  }, [guarded]);

  const handleRemoveExtra = useCallback(async (id: string) => {
    await guarded(() => removePersonalLesson(id));
  }, [guarded]);

  const handleAddLesson = useCallback(async (lesson: Record<string, unknown>) => {
    await guarded(() => addPersonalLesson(lesson));
  }, [guarded]);

  const handleSubgroup = useCallback(async (value: 1 | 2 | null) => {
    await guarded(() => setScheduleSubgroup(value));
  }, [guarded]);

  const handleSaveGroup = useCallback(async () => {
    if (!/^\d{2,4}$/.test(groupDigits)) {
      toast({ title: 'Номер группы', description: 'Введи 2–4 цифры, например 208' });
      return;
    }
    setGroupSaving(true);
    try {
      await saveStudyGroupFromSchedule(groupDigits);
      await load();
    } catch (e) {
      toast({
        title: 'Не получилось',
        description: e instanceof Error ? e.message : 'Попробуй ещё раз',
      });
    } finally {
      setGroupSaving(false);
    }
  }, [groupDigits, load, toast]);

  const shiftWeek = useCallback((delta: number) => {
    const next = addDays(weekStart, delta * 7);
    setWeekStart(next);
    void load({ from: next });
  }, [weekStart, load]);

  // ── Экраны без данных ────────────────────────────────────────────────────

  const header = (
    <div
      className="px-4 pt-1 pb-3 sticky top-0 z-10 flex-shrink-0"
      style={{
        background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--c-border)',
        paddingTop: 'max(12px, calc(var(--header-pt) - 24px))',
      }}
    >
      <div className="flex items-start justify-between px-1">
        <div className="w-[60px] flex-shrink-0" />
        <div className="flex flex-col items-center justify-center flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <AppBrandIcon onClick={onSecretTap} />
            <h1 className="text-[16px] font-bold tracking-tight leading-tight truncate" style={{ color: 'var(--c-text)' }}>
              {APP_BRAND_NAME}
            </h1>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: 'var(--c-primary)' }}>
            Занятия{data?.studyGroup ? ` · ${data.studyGroup}` : ''}
          </p>
        </div>
        <div className="w-[60px] flex-shrink-0 flex justify-end pt-1">
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Обновить расписание"
            style={{ color: 'var(--c-muted)' }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex gap-1 mt-3 p-1 rounded-2xl" style={{ background: 'var(--c-card)' }}>
        {VIEW_TABS.map(tab => {
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className="flex-1 h-9 rounded-xl text-[12.5px] font-bold transition-all"
              style={{
                background: active ? 'var(--c-primary)' : 'transparent',
                color: active ? 'var(--c-bg)' : 'var(--c-muted)',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const wrap = (content: React.ReactNode) => (
    <div className="flex flex-col h-full">
      {header}
      <ScrollArea className="flex-1 scroll-container">
        <div className="px-3 pt-3 mx-auto max-w-2xl w-full" style={{ paddingBottom: 'var(--scroll-pb)' }}>
          {content}
        </div>
      </ScrollArea>

      <AnimatePresence>
        {openOccurrence && (
          <LessonSheet
            occurrence={openOccurrence}
            note={notes[openOccurrence.key] ?? ''}
            done={doneSet.has(openOccurrence.key)}
            canEdit={canEdit}
            subjectAvailable={
              !!openOccurrence.lesson.subjectId
              && availableSubjects.includes(openOccurrence.lesson.subjectId)
            }
            onClose={() => setOpenOccurrence(null)}
            onSaveNote={note => handleSaveNote(openOccurrence.key, note)}
            onToggleDone={() => handleToggleDone(openOccurrence.key)}
            onHide={() => handleHide(openOccurrence.key)}
            onRemoveExtra={
              openOccurrence.source === 'personal'
                ? () => handleRemoveExtra(openOccurrence.lesson.id)
                : undefined
            }
            onOpenSubject={onOpenSubject}
          />
        )}
        {addingLesson && (
          <AddLessonSheet
            defaultDate={today}
            onClose={() => setAddingLesson(false)}
            onSubmit={handleAddLesson}
          />
        )}
      </AnimatePresence>
    </div>
  );

  if (loading && !data) {
    return wrap(
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--c-primary)' }} />
      </div>,
    );
  }

  if (error) {
    return wrap(
      <EmptyState
        icon={<AlertCircle className="w-9 h-9" />}
        title="Расписание не загрузилось"
        text={error}
        action={(
          <button
            type="button"
            onClick={() => void load()}
            className="mt-1 px-5 h-11 rounded-2xl text-[13px] font-bold"
            style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
          >
            Попробовать снова
          </button>
        )}
      />,
    );
  }

  if (data?.needsFaculty) {
    return wrap(
      <EmptyState
        icon={<GraduationCap className="w-9 h-9" />}
        title="Сначала выбери факультет"
        text="Расписание и учебный план привязаны к факультету и курсу. Открой вход по коду факультета — и раздел заполнится."
      />,
    );
  }

  if (data?.needsStudyGroup) {
    return wrap(
      <div className="pt-6">
        <EmptyState
          icon={<Users className="w-9 h-9" />}
          title="Укажи свою группу"
          text={`${data.facultyLabel}. Введи номер группы — покажем расписание пар и учебный план курса.`}
        />
        <div className="flex gap-2 mt-2 px-4">
          <input
            inputMode="numeric"
            value={groupDigits}
            onChange={e => setGroupDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="208"
            className="flex-1 h-12 rounded-2xl px-4 text-[15px] font-bold text-center focus:outline-none"
            style={{
              background: 'var(--c-card)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text)',
            }}
          />
          <button
            type="button"
            onClick={() => void handleSaveGroup()}
            disabled={groupSaving}
            className="px-6 h-12 rounded-2xl text-[14px] font-bold"
            style={{ background: 'var(--c-primary)', color: 'var(--c-bg)', opacity: groupSaving ? 0.6 : 1 }}
          >
            {groupSaving ? '…' : 'Готово'}
          </button>
        </div>
      </div>,
    );
  }

  // ── Верхняя плашка «смотрю чужую группу» ────────────────────────────────

  const foreignGroupBanner = data && !data.isOwnGroup && (
    <div
      className="rounded-2xl px-3 py-2.5 mb-3 flex items-center gap-2"
      style={{
        background: 'color-mix(in srgb, hsl(39 82% 43%) 14%, var(--c-card))',
        border: '1px solid color-mix(in srgb, hsl(39 82% 43%) 34%, transparent)',
      }}
    >
      <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'hsl(39 82% 43%)' }} />
      <span className="text-[12.5px] flex-1" style={{ color: 'var(--c-text)' }}>
        Смотришь группу {data.studyGroup} — только чтение
      </span>
      <button
        type="button"
        onClick={() => { setViewGroup(null); }}
        className="text-[12px] font-bold"
        style={{ color: 'var(--c-primary)' }}
      >
        К своей
      </button>
    </div>
  );

  // ── Вид «Сегодня» ────────────────────────────────────────────────────────

  if (view === 'today') {
    const todayOccurrences = todayDay?.occurrences ?? [];
    const minutes = nextOccurrence && nextOccurrence.date === today
      ? minutesUntil(nextOccurrence.start, nowTime)
      : null;

    return wrap(
      <div className="space-y-4">
        {foreignGroupBanner}

        {nextOccurrence && (
          <div
            className="rounded-3xl p-4"
            style={{
              background: `color-mix(in srgb, ${LESSON_KIND_COLOR[nextOccurrence.lesson.kind]} 14%, var(--c-card))`,
              border: `1px solid color-mix(in srgb, ${LESSON_KIND_COLOR[nextOccurrence.lesson.kind]} 34%, transparent)`,
            }}
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
              <Clock className="w-3.5 h-3.5" />
              {nextOccurrence.date === today
                ? (minutes != null ? humanCountdown(minutes) : 'Следующая пара')
                : `${WEEKDAY_SHORT[nextOccurrence.weekday]}, ${formatDateHuman(nextOccurrence.date)}`}
            </div>
            <h2 className="text-[19px] font-bold mt-1.5 leading-tight" style={{ color: 'var(--c-text)' }}>
              {nextOccurrence.lesson.title}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[13px]" style={{ color: 'var(--c-muted)' }}>
              <span>{nextOccurrence.start}—{nextOccurrence.end}</span>
              {nextOccurrence.lesson.room && <span>{nextOccurrence.lesson.room}</span>}
              {nextOccurrence.lesson.teacher && <span className="truncate">{nextOccurrence.lesson.teacher}</span>}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <SectionTitle>
              {WEEKDAY_LABELS[todayDay?.weekday ?? 1]}, {formatDateHuman(today)}
            </SectionTitle>
            {data?.group && (
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                {data.group.currentParity === 'odd' ? 'Нечётная' : 'Чётная'}
              </span>
            )}
          </div>

          {todayOccurrences.length === 0 ? (
            <EmptyState
              title={data?.hasSchedule ? 'Сегодня пар нет' : 'Расписание ещё не заполнено'}
              text={data?.hasSchedule
                ? 'Свободный день — хороший момент разобрать сложную тему.'
                : 'Староста или админ загрузит расписание группы, и оно появится здесь.'}
            />
          ) : (
            <div className="space-y-2">
              {todayOccurrences.map(occ => (
                <LessonCard
                  key={occ.key}
                  occurrence={occ}
                  note={notes[occ.key]}
                  done={doneSet.has(occ.key)}
                  highlight={occ.key === nextOccurrence?.key}
                  onOpen={setOpenOccurrence}
                />
              ))}
            </div>
          )}
        </div>

        {data?.plan?.upcoming?.length ? (
          <div>
            <SectionTitle>Скоро сдавать</SectionTitle>
            <div className="space-y-2">
              {data.plan.upcoming.map(discipline => (
                <div
                  key={discipline.id}
                  className="rounded-2xl px-3.5 py-3 flex items-center gap-3"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-bold truncate" style={{ color: 'var(--c-text)' }}>
                      {discipline.title}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--c-muted)' }}>
                      {CONTROL_FORM_LABELS[discipline.control]}
                      {discipline.controlDate ? ` · ${formatDateHuman(discipline.controlDate)}` : ''}
                    </div>
                  </div>
                  <Chip color={CONTROL_FORM_COLOR[discipline.control]}>
                    {discipline.controlDate ? daysUntilLabel(discipline.controlDate, today) : '—'}
                  </Chip>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canEdit && (
          <button
            type="button"
            onClick={() => setAddingLesson(true)}
            className="w-full h-12 rounded-2xl text-[13.5px] font-bold flex items-center justify-center gap-2"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
          >
            <Plus className="w-4 h-4" />
            Добавить своё занятие
          </button>
        )}
      </div>,
    );
  }

  // ── Вид «Неделя» ─────────────────────────────────────────────────────────

  if (view === 'week') {
    const weekLabel = `${formatDateHuman(weekStart)} — ${formatDateHuman(addDays(weekStart, 6))}`;

    return wrap(
      <div className="space-y-3">
        {foreignGroupBanner}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
            aria-label="Предыдущая неделя"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div
            className="flex-1 h-10 rounded-xl flex flex-col items-center justify-center"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
          >
            <span className="text-[12.5px] font-bold leading-none" style={{ color: 'var(--c-text)' }}>
              {weekLabel}
            </span>
            {data?.group && (
              <span className="text-[10px] mt-0.5 leading-none" style={{ color: 'var(--c-muted)' }}>
                {days[0] && days[0].parity === 'odd' ? 'нечётная неделя' : 'чётная неделя'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
            aria-label="Следующая неделя"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>Подгруппа:</span>
            {([null, 1, 2] as (1 | 2 | null)[]).map(value => {
              const active = (personal?.subgroup ?? null) === value;
              return (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => void handleSubgroup(value)}
                  className="px-3 h-7 rounded-lg text-[11.5px] font-bold"
                  style={{
                    background: active ? 'var(--c-primary)' : 'var(--c-card)',
                    color: active ? 'var(--c-bg)' : 'var(--c-muted)',
                    border: '1px solid var(--c-border)',
                  }}
                >
                  {value === null ? 'Все' : `${value}-я`}
                </button>
              );
            })}
          </div>
        )}

        {days.every(d => d.occurrences.length === 0) ? (
          <EmptyState
            title={data?.hasSchedule ? 'На этой неделе пар нет' : 'Расписание ещё не заполнено'}
            text={data?.hasSchedule
              ? 'Возможно, каникулы или практика. Полистай соседние недели.'
              : 'Как только админ загрузит сетку занятий группы, она появится здесь.'}
          />
        ) : (
          days.map(day => {
            const isToday = day.date === today;
            if (day.occurrences.length === 0 && day.weekday === 7) return null;
            return (
              <div key={day.date}>
                <div className="flex items-center gap-2 px-1 mb-1.5">
                  <span
                    className="text-[12px] font-bold uppercase tracking-wide"
                    style={{ color: isToday ? 'var(--c-primary)' : 'var(--c-muted)' }}
                  >
                    {WEEKDAY_SHORT[day.weekday]}, {formatDateHuman(day.date)}
                  </span>
                  {isToday && <Chip color="var(--c-primary)">сегодня</Chip>}
                </div>
                {day.occurrences.length === 0 ? (
                  <div
                    className="rounded-xl px-3 py-2 text-[12px]"
                    style={{ background: 'var(--c-card)', color: 'var(--c-muted)' }}
                  >
                    Пар нет
                  </div>
                ) : (
                  <div className="space-y-2">
                    {day.occurrences.map(occ => (
                      <LessonCard
                        key={occ.key}
                        occurrence={occ}
                        note={notes[occ.key]}
                        done={doneSet.has(occ.key)}
                        onOpen={setOpenOccurrence}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        <OtherGroupSearch
          facultyId={data?.facultyId ?? ''}
          onView={(facultyId, studyGroup) => {
            setViewGroup({ facultyId, studyGroup });
            setView('week');
          }}
        />
      </div>,
    );
  }

  // ── Вид «План курса» ─────────────────────────────────────────────────────

  const plan = data?.plan ?? null;
  const progress = semesterProgressPct(activeSemester, today);

  return wrap(
    <div className="space-y-4">
      {foreignGroupBanner}

      {!plan ? (
        <EmptyState
          icon={<GraduationCap className="w-9 h-9" />}
          title="Учебный план ещё не опубликован"
          text={`План ${data?.course ?? ''} курса появится здесь, как только его загрузят. Пока можно смотреть расписание.`}
        />
      ) : (
        <>
          <div
            className="rounded-3xl p-4"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                  {data?.facultyLabel} · {data?.course} курс
                </div>
                <h2 className="text-[17px] font-bold mt-0.5" style={{ color: 'var(--c-text)' }}>
                  {plan.academicYear} учебный год
                </h2>
              </div>
              <div className="flex gap-1">
                {[1, 2].map(n => {
                  const active = (semester ?? plan.activeSemester ?? 1) === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSemester(n as 1 | 2)}
                      className="w-9 h-9 rounded-xl text-[12.5px] font-bold"
                      style={{
                        background: active ? 'var(--c-primary)' : 'var(--c-bg)',
                        color: active ? 'var(--c-bg)' : 'var(--c-muted)',
                        border: '1px solid var(--c-border)',
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            {progress != null && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--c-muted)' }}>
                  <span>Семестр пройден</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${progress}%`, background: 'var(--c-primary)' }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 mt-3.5">
              {[
                { label: 'Предметов', value: activeSemester?.disciplines.length ?? 0 },
                { label: 'Экзаменов', value: activeSemester?.disciplines.filter(d => d.control === 'exam').length ?? 0 },
                { label: 'Зачётов', value: activeSemester?.disciplines.filter(d => d.control === 'credit' || d.control === 'credit_grade').length ?? 0 },
                {
                  label: 'Часов',
                  value: (activeSemester?.disciplines ?? []).reduce((s, d) => s + disciplineTotalHours(d), 0),
                },
              ].map(stat => (
                <div key={stat.label} className="text-center rounded-xl py-2" style={{ background: 'var(--c-bg)' }}>
                  <div className="text-[17px] font-bold leading-none" style={{ color: 'var(--c-text)' }}>
                    {stat.value}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wide mt-1" style={{ color: 'var(--c-muted)' }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {activeSemester && activeSemester.disciplines.length > 0 ? (
            <div className="space-y-2">
              <SectionTitle>Дисциплины семестра</SectionTitle>
              {activeSemester.disciplines.map(discipline => (
                <DisciplineCard
                  key={discipline.id}
                  discipline={discipline}
                  today={today}
                  subjectAvailable={
                    !!discipline.subjectId && availableSubjects.includes(discipline.subjectId)
                  }
                  onOpenSubject={onOpenSubject}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="В этом семестре пусто"
              text="Дисциплины ещё не добавлены в план."
            />
          )}

          {plan.note && (
            <p className="text-[12px] leading-relaxed px-1" style={{ color: 'var(--c-muted)' }}>
              {plan.note}
            </p>
          )}
        </>
      )}
    </div>,
  );
};

// ─── Поиск чужой группы ────────────────────────────────────────────────────

const OtherGroupSearch: React.FC<{
  facultyId: string;
  onView: (facultyId: string, studyGroup: string) => void;
}> = ({ facultyId, onView }) => {
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState('');

  if (!facultyId) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-11 rounded-2xl text-[12.5px] font-semibold flex items-center justify-center gap-2"
        style={{ background: 'transparent', color: 'var(--c-muted)' }}
      >
        <Search className="w-4 h-4" />
        Посмотреть расписание другой группы
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        inputMode="numeric"
        value={digits}
        onChange={e => setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="Номер группы, например 208"
        className="flex-1 h-11 rounded-xl px-3 text-[13px] focus:outline-none"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
      />
      <button
        type="button"
        onClick={() => {
          const group = buildStudyGroupFromDigits(digits, facultyId);
          if (group) onView(facultyId, group);
          setOpen(false);
        }}
        className="px-4 h-11 rounded-xl text-[13px] font-bold"
        style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
      >
        Открыть
      </button>
    </div>
  );
};
