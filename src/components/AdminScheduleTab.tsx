'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FACULTY_SHORT_LABEL } from '@/lib/facultyCodes';
import type { FacultyId } from '@/lib/groupRegistry';
import {
  CONTROL_FORM_LABELS,
  createEmptyCurriculumPlan,
  type ControlForm,
  type CurriculumPlan,
  type CurriculumDiscipline,
} from '@/lib/curriculum';
import {
  DEFAULT_PAIR_TIMES,
  LESSON_KIND_LABELS,
  WEEKDAY_SHORT,
  createEmptyGroupSchedule,
  krskDateKey,
  mondayOf,
  type GroupSchedule,
  type LessonKind,
  type ScheduleLesson,
  type WeekParity,
  type Weekday,
} from '@/lib/schedule';

const T = {
  surface:     '#FFFFFF',
  surfaceAlt:  '#FAF8F3',
  border:      '#E7E2D6',
  text:        '#1F1B14',
  textMuted:   '#6B6558',
  textFaint:   '#9A9485',
  accent:      '#1F7A6E',
  accentSoft:  '#E5F1EE',
  danger:      '#A03A2E',
  dangerSoft:  '#F7E3E0',
};

type AdminScheduleSection = 'groups' | 'plan';

interface FacultyNode {
  facultyId: FacultyId;
  label: string;
  maxCourse: number;
  courses: { course: number; groups: string[] }[];
}

interface GroupRow {
  facultyId: FacultyId;
  studyGroup: string;
  course: number;
  academicYear: string;
  lessonCount: number;
  weeklyPairs: number;
  overrideCount: number;
  updatedAt: string;
}

interface PlanRow {
  facultyId: FacultyId;
  course: number;
  academicYear: string;
  disciplines: number;
  updatedAt: string;
}

interface SubjectOption {
  id: string;
  label: string;
  color: string;
}

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6];
const PAIRS = [1, 2, 3, 4, 5, 6, 7];
const KINDS = Object.keys(LESSON_KIND_LABELS) as LessonKind[];
const CONTROLS = Object.keys(CONTROL_FORM_LABELS) as ControlForm[];
const PARITIES: { id: WeekParity; label: string }[] = [
  { id: 'every', label: 'Каждую' },
  { id: 'odd',   label: 'Нечёт' },
  { id: 'even',  label: 'Чёт' },
];

function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const inputStyle: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  fontSize: 13,
  padding: '7px 9px',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: T.textFaint,
  marginBottom: 4,
  display: 'block',
};

const cardStyle: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 12,
  marginBottom: 10,
};

function Button({
  children, onClick, tone = 'default', disabled, grow,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  grow?: boolean;
}) {
  const palette = tone === 'primary'
    ? { bg: T.accent, fg: '#FFFFFF', border: T.accent }
    : tone === 'danger'
      ? { bg: T.dangerSoft, fg: T.danger, border: `${T.danger}44` }
      : { bg: T.surfaceAlt, fg: T.text, border: T.border };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: grow ? 1 : undefined,
        padding: '9px 13px',
        borderRadius: 9,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        fontSize: 12.5,
        fontWeight: 700,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export default function AdminScheduleTab({
  secret,
  showToast,
}: {
  secret: string;
  showToast: (msg: string) => void;
}) {
  const [section, setSection] = useState<AdminScheduleSection>('groups');
  const [faculties, setFaculties] = useState<FacultyNode[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [groupRows, setGroupRows] = useState<GroupRow[]>([]);
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);

  const [facultyId, setFacultyId] = useState<FacultyId>('stomatology');
  const [course, setCourse] = useState(2);
  const [studyGroup, setStudyGroup] = useState('');

  const [schedule, setSchedule] = useState<GroupSchedule | null>(null);
  const [plan, setPlan] = useState<CurriculumPlan | null>(null);
  const [planSemester, setPlanSemester] = useState<1 | 2>(1);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set());

  const call = useCallback(async <TRes,>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<TRes | null> => {
    const initData = getTelegramInitData();
    if (!initData || !secret) {
      showToast('Нет доступа админа');
      return null;
    }
    try {
      const res = await fetch('/api/admin-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, secret, initData, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
      return data as TRes;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка запроса');
      return null;
    }
  }, [secret, showToast]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    const data = await call<{
      faculties: FacultyNode[];
      groups: GroupRow[];
      plans: PlanRow[];
      subjects: SubjectOption[];
    }>('overview');
    if (data) {
      setFaculties(data.faculties ?? []);
      setGroupRows(data.groups ?? []);
      setPlanRows(data.plans ?? []);
      setSubjects(data.subjects ?? []);
    }
    setLoading(false);
  }, [call]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const facultyNode = useMemo(
    () => faculties.find(f => f.facultyId === facultyId) ?? null,
    [faculties, facultyId],
  );

  const courseGroups = useMemo(
    () => facultyNode?.courses.find(c => c.course === course)?.groups ?? [],
    [facultyNode, course],
  );

  useEffect(() => {
    if (courseGroups.length && !courseGroups.includes(studyGroup)) {
      setStudyGroup(courseGroups[0]);
    }
  }, [courseGroups, studyGroup]);

  // ── Расписание группы ───────────────────────────────────────────────────

  const loadGroup = useCallback(async (group: string) => {
    if (!group) return;
    setLoading(true);
    const data = await call<{ schedule: GroupSchedule }>('get_group', {
      facultyId,
      studyGroup: group,
    });
    setSchedule(data?.schedule ?? createEmptyGroupSchedule(facultyId, group, course));
    setLoading(false);
  }, [call, facultyId, course]);

  useEffect(() => {
    if (section === 'groups' && studyGroup) void loadGroup(studyGroup);
  }, [section, studyGroup, loadGroup]);

  const patchSchedule = (patch: Partial<GroupSchedule>) => {
    setSchedule(prev => (prev ? { ...prev, ...patch } : prev));
  };

  const patchLesson = (id: string, patch: Partial<ScheduleLesson>) => {
    setSchedule(prev => prev && {
      ...prev,
      lessons: prev.lessons.map(l => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const addLesson = (weekday: Weekday) => {
    setSchedule(prev => prev && {
      ...prev,
      lessons: [...prev.lessons, {
        id: newId('l'),
        weekday,
        pair: 1,
        weekParity: 'every',
        title: '',
        kind: 'practice',
        subjectId: null,
        subgroup: null,
      }],
    });
  };

  const removeLesson = (id: string) => {
    setSchedule(prev => prev && { ...prev, lessons: prev.lessons.filter(l => l.id !== id) });
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    const empty = schedule.lessons.filter(l => !l.title.trim());
    if (empty.length) {
      showToast('У некоторых пар пустое название');
      return;
    }
    setSaving(true);
    const data = await call<{ schedule: GroupSchedule }>('save_group', {
      facultyId,
      studyGroup,
      course,
      schedule,
    });
    if (data) {
      setSchedule(data.schedule);
      showToast(`Расписание ${studyGroup} сохранено`);
      void loadOverview();
    }
    setSaving(false);
  };

  const deleteSchedule = async () => {
    setSaving(true);
    const data = await call<{ ok: true }>('delete_group', { facultyId, studyGroup });
    if (data) {
      setSchedule(createEmptyGroupSchedule(facultyId, studyGroup, course));
      showToast(`Расписание ${studyGroup} удалено`);
      void loadOverview();
    }
    setSaving(false);
  };

  const copySchedule = async () => {
    if (!copyTargets.size) {
      showToast('Выбери группы для копирования');
      return;
    }
    setSaving(true);
    const data = await call<{ copied: number }>('copy_group', {
      facultyId,
      studyGroup,
      targets: [...copyTargets],
    });
    if (data) {
      showToast(`Скопировано в ${data.copied} групп`);
      setCopyTargets(new Set());
      void loadOverview();
    }
    setSaving(false);
  };

  // ── Учебный план ────────────────────────────────────────────────────────

  const loadPlan = useCallback(async () => {
    setLoading(true);
    const data = await call<{ plan: CurriculumPlan }>('get_curriculum', { facultyId, course });
    setPlan(data?.plan ?? createEmptyCurriculumPlan(facultyId, course));
    setLoading(false);
  }, [call, facultyId, course]);

  useEffect(() => {
    if (section === 'plan') void loadPlan();
  }, [section, loadPlan]);

  const currentSemester = plan?.semesters.find(s => s.semester === planSemester) ?? null;

  const patchSemester = (patch: Partial<NonNullable<typeof currentSemester>>) => {
    setPlan(prev => prev && {
      ...prev,
      semesters: prev.semesters.map(s => (s.semester === planSemester ? { ...s, ...patch } : s)),
    });
  };

  const patchDiscipline = (id: string, patch: Partial<CurriculumDiscipline>) => {
    if (!currentSemester) return;
    patchSemester({
      disciplines: currentSemester.disciplines.map(d => (d.id === id ? { ...d, ...patch } : d)),
    });
  };

  const addDiscipline = () => {
    if (!currentSemester) return;
    patchSemester({
      disciplines: [...currentSemester.disciplines, {
        id: newId('d'),
        title: '',
        control: 'none',
        subjectId: null,
      }],
    });
  };

  const removeDiscipline = (id: string) => {
    if (!currentSemester) return;
    patchSemester({ disciplines: currentSemester.disciplines.filter(d => d.id !== id) });
  };

  const savePlan = async () => {
    if (!plan) return;
    if (plan.semesters.some(s => s.disciplines.some(d => !d.title.trim()))) {
      showToast('У некоторых дисциплин пустое название');
      return;
    }
    setSaving(true);
    const data = await call<{ plan: CurriculumPlan }>('save_curriculum', {
      facultyId,
      course,
      plan,
    });
    if (data) {
      setPlan(data.plan);
      showToast(`План ${course} курса сохранён`);
      void loadOverview();
    }
    setSaving(false);
  };

  // ── Разметка ────────────────────────────────────────────────────────────

  const scopeSelector = (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {faculties.map(f => (
          <button
            key={f.facultyId}
            type="button"
            onClick={() => setFacultyId(f.facultyId)}
            style={{
              flex: 1, padding: '8px 6px', borderRadius: 9, fontSize: 11.5, fontWeight: 700,
              border: `1px solid ${facultyId === f.facultyId ? T.accent : T.border}`,
              background: facultyId === f.facultyId ? T.accentSoft : T.surfaceAlt,
              color: facultyId === f.facultyId ? T.accent : T.textMuted,
            }}
          >
            {FACULTY_SHORT_LABEL[f.facultyId] ?? f.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Array.from({ length: facultyNode?.maxCourse ?? 5 }, (_, i) => i + 1).map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setCourse(c)}
            style={{
              width: 40, height: 34, borderRadius: 9, fontSize: 12.5, fontWeight: 700,
              border: `1px solid ${course === c ? T.accent : T.border}`,
              background: course === c ? T.accentSoft : T.surfaceAlt,
              color: course === c ? T.accent : T.textMuted,
            }}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {([
          { id: 'groups' as AdminScheduleSection, label: '🗓 Расписание групп' },
          { id: 'plan' as AdminScheduleSection, label: '📘 Учебный план' },
        ]).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700,
              border: `1px solid ${section === tab.id ? T.accent : T.border}`,
              background: section === tab.id ? T.accentSoft : T.surfaceAlt,
              color: section === tab.id ? T.accent : T.textMuted,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {scopeSelector}

      {loading && (
        <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          Загрузка…
        </div>
      )}

      {section === 'groups' && (
        <>
          <div style={cardStyle}>
            <span style={labelStyle}>Группа {course} курса</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {courseGroups.map(g => {
                const filled = groupRows.some(
                  r => r.facultyId === facultyId && r.studyGroup === g && r.lessonCount > 0,
                );
                const active = studyGroup === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setStudyGroup(g)}
                    style={{
                      padding: '6px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                      border: `1px solid ${active ? T.accent : T.border}`,
                      background: active ? T.accentSoft : filled ? '#EAF5EE' : T.surfaceAlt,
                      color: active ? T.accent : T.textMuted,
                    }}
                  >
                    {g}{filled ? ' ✓' : ''}
                  </button>
                );
              })}
              {!courseGroups.length && (
                <span style={{ fontSize: 12, color: T.textFaint }}>Нет групп в сетке курса</span>
              )}
            </div>
          </div>

          {schedule && (
            <>
              <div style={cardStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <span style={labelStyle}>Учебный год</span>
                    <input
                      value={schedule.academicYear}
                      onChange={e => patchSchedule({ academicYear: e.target.value })}
                      placeholder="2026/2027"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <span style={labelStyle}>Пн нечётной недели</span>
                    <input
                      type="date"
                      value={schedule.weekAnchorMonday}
                      onChange={e => patchSchedule({
                        weekAnchorMonday: e.target.value ? mondayOf(e.target.value) : mondayOf(krskDateKey()),
                      })}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: T.textFaint, marginTop: 6, lineHeight: 1.4 }}>
                  От этой даты считается чередование числителя и знаменателя.
                  Время пар — стандартное ({DEFAULT_PAIR_TIMES[0].start}, {DEFAULT_PAIR_TIMES[1].start}, …).
                </p>
              </div>

              {WEEKDAYS.map(weekday => {
                const dayLessons = schedule.lessons
                  .filter(l => l.weekday === weekday)
                  .sort((a, b) => a.pair - b.pair);
                return (
                  <div key={weekday} style={cardStyle}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: dayLessons.length ? 8 : 0,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>
                        {WEEKDAY_SHORT[weekday]}
                        <span style={{ fontWeight: 500, color: T.textFaint, marginLeft: 6 }}>
                          {dayLessons.length ? `${dayLessons.length} пар` : 'пусто'}
                        </span>
                      </span>
                      <Button onClick={() => addLesson(weekday)}>+ пара</Button>
                    </div>

                    {dayLessons.map(lesson => (
                      <div
                        key={lesson.id}
                        style={{
                          background: T.surfaceAlt,
                          border: `1px solid ${T.border}`,
                          borderRadius: 10,
                          padding: 9,
                          marginBottom: 7,
                        }}
                      >
                        <input
                          value={lesson.title}
                          onChange={e => patchLesson(lesson.id, { title: e.target.value })}
                          placeholder="Название дисциплины"
                          style={{ ...inputStyle, fontWeight: 700, marginBottom: 6 }}
                        />

                        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: 6, marginBottom: 6 }}>
                          <select
                            value={lesson.pair}
                            onChange={e => patchLesson(lesson.id, { pair: Number(e.target.value) })}
                            style={inputStyle}
                          >
                            {PAIRS.map(p => <option key={p} value={p}>{p} пара</option>)}
                          </select>
                          <select
                            value={lesson.kind}
                            onChange={e => patchLesson(lesson.id, { kind: e.target.value as LessonKind })}
                            style={inputStyle}
                          >
                            {KINDS.map(k => <option key={k} value={k}>{LESSON_KIND_LABELS[k]}</option>)}
                          </select>
                          <select
                            value={lesson.weekParity}
                            onChange={e => patchLesson(lesson.id, { weekParity: e.target.value as WeekParity })}
                            style={inputStyle}
                          >
                            {PARITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                          </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                          <input
                            value={lesson.room ?? ''}
                            onChange={e => patchLesson(lesson.id, { room: e.target.value })}
                            placeholder="Кабинет"
                            style={inputStyle}
                          />
                          <input
                            value={lesson.teacher ?? ''}
                            onChange={e => patchLesson(lesson.id, { teacher: e.target.value })}
                            placeholder="Преподаватель"
                            style={inputStyle}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 6, alignItems: 'center' }}>
                          <select
                            value={lesson.subjectId ?? ''}
                            onChange={e => patchLesson(lesson.id, { subjectId: e.target.value || null })}
                            style={inputStyle}
                          >
                            <option value="">Без связи с предметом</option>
                            {subjects.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                          <select
                            value={lesson.subgroup ?? ''}
                            onChange={e => patchLesson(lesson.id, {
                              subgroup: e.target.value ? (Number(e.target.value) as 1 | 2) : null,
                            })}
                            style={inputStyle}
                          >
                            <option value="">Вся гр.</option>
                            <option value="1">1 подгр.</option>
                            <option value="2">2 подгр.</option>
                          </select>
                          <Button tone="danger" onClick={() => removeLesson(lesson.id)}>✕</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Button tone="primary" grow disabled={saving} onClick={() => void saveSchedule()}>
                  {saving ? 'Сохраняю…' : `Сохранить ${studyGroup}`}
                </Button>
                <Button tone="danger" disabled={saving} onClick={() => void deleteSchedule()}>
                  Удалить
                </Button>
              </div>

              <div style={cardStyle}>
                <span style={labelStyle}>Скопировать это расписание в другие группы</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9 }}>
                  {courseGroups.filter(g => g !== studyGroup).map(g => {
                    const active = copyTargets.has(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setCopyTargets(prev => {
                          const next = new Set(prev);
                          if (next.has(g)) next.delete(g);
                          else next.add(g);
                          return next;
                        })}
                        style={{
                          padding: '6px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                          border: `1px solid ${active ? T.accent : T.border}`,
                          background: active ? T.accentSoft : T.surfaceAlt,
                          color: active ? T.accent : T.textMuted,
                        }}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    grow
                    onClick={() => setCopyTargets(new Set(courseGroups.filter(g => g !== studyGroup)))}
                  >
                    Весь курс
                  </Button>
                  <Button tone="primary" grow disabled={saving} onClick={() => void copySchedule()}>
                    Скопировать ({copyTargets.size})
                  </Button>
                </div>
                <p style={{ fontSize: 11, color: T.textFaint, marginTop: 7, lineHeight: 1.4 }}>
                  Копируется только недельная сетка. Разовые переносы остаются у исходной группы.
                </p>
              </div>
            </>
          )}

          <div style={cardStyle}>
            <span style={labelStyle}>Заполненные группы ({groupRows.length})</span>
            {groupRows.length === 0 ? (
              <span style={{ fontSize: 12, color: T.textFaint }}>Пока ни одной</span>
            ) : groupRows.map(row => (
              <div
                key={`${row.facultyId}:${row.studyGroup}`}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: `1px solid ${T.border}`, fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 700, color: T.text }}>
                  {row.studyGroup}
                  <span style={{ fontWeight: 500, color: T.textFaint, marginLeft: 6 }}>
                    {FACULTY_SHORT_LABEL[row.facultyId]}
                  </span>
                </span>
                <span style={{ color: T.textMuted }}>{row.lessonCount} пар в сетке</span>
              </div>
            ))}
          </div>
        </>
      )}

      {section === 'plan' && plan && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {[1, 2].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPlanSemester(n as 1 | 2)}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                    border: `1px solid ${planSemester === n ? T.accent : T.border}`,
                    background: planSemester === n ? T.accentSoft : T.surfaceAlt,
                    color: planSemester === n ? T.accent : T.textMuted,
                  }}
                >
                  {n} семестр
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <span style={labelStyle}>Учебный год</span>
                <input
                  value={plan.academicYear}
                  onChange={e => setPlan({ ...plan, academicYear: e.target.value })}
                  placeholder="2026/2027"
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={labelStyle}>Начало</span>
                <input
                  type="date"
                  value={currentSemester?.startsOn ?? ''}
                  onChange={e => patchSemester({ startsOn: e.target.value || null })}
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={labelStyle}>Конец</span>
                <input
                  type="date"
                  value={currentSemester?.endsOn ?? ''}
                  onChange={e => patchSemester({ endsOn: e.target.value || null })}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {(currentSemester?.disciplines ?? []).map(discipline => (
            <div key={discipline.id} style={cardStyle}>
              <input
                value={discipline.title}
                onChange={e => patchDiscipline(discipline.id, { title: e.target.value })}
                placeholder="Название дисциплины"
                style={{ ...inputStyle, fontWeight: 700, marginBottom: 6 }}
              />
              <input
                value={discipline.department ?? ''}
                onChange={e => patchDiscipline(discipline.id, { department: e.target.value })}
                placeholder="Кафедра"
                style={{ ...inputStyle, marginBottom: 6 }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                <input
                  type="number"
                  value={discipline.hoursLecture ?? ''}
                  onChange={e => patchDiscipline(discipline.id, { hoursLecture: Number(e.target.value) || undefined })}
                  placeholder="Лек"
                  style={inputStyle}
                />
                <input
                  type="number"
                  value={discipline.hoursPractice ?? ''}
                  onChange={e => patchDiscipline(discipline.id, { hoursPractice: Number(e.target.value) || undefined })}
                  placeholder="Практ"
                  style={inputStyle}
                />
                <input
                  type="number"
                  value={discipline.hoursSelf ?? ''}
                  onChange={e => patchDiscipline(discipline.id, { hoursSelf: Number(e.target.value) || undefined })}
                  placeholder="Сам"
                  style={inputStyle}
                />
                <input
                  type="number"
                  value={discipline.credits ?? ''}
                  onChange={e => patchDiscipline(discipline.id, { credits: Number(e.target.value) || undefined })}
                  placeholder="з.е."
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <select
                  value={discipline.control}
                  onChange={e => patchDiscipline(discipline.id, { control: e.target.value as ControlForm })}
                  style={inputStyle}
                >
                  {CONTROLS.map(c => <option key={c} value={c}>{CONTROL_FORM_LABELS[c]}</option>)}
                </select>
                <input
                  type="date"
                  value={discipline.controlDate ?? ''}
                  onChange={e => patchDiscipline(discipline.id, { controlDate: e.target.value || null })}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
                <select
                  value={discipline.subjectId ?? ''}
                  onChange={e => patchDiscipline(discipline.id, { subjectId: e.target.value || null })}
                  style={inputStyle}
                >
                  <option value="">Материалов в приложении нет</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <Button tone="danger" onClick={() => removeDiscipline(discipline.id)}>✕</Button>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button grow onClick={addDiscipline}>+ Дисциплина</Button>
            <Button tone="primary" grow disabled={saving} onClick={() => void savePlan()}>
              {saving ? 'Сохраняю…' : 'Сохранить план'}
            </Button>
          </div>

          <div style={cardStyle}>
            <span style={labelStyle}>Опубликованные планы ({planRows.length})</span>
            {planRows.length === 0 ? (
              <span style={{ fontSize: 12, color: T.textFaint }}>Пока ни одного</span>
            ) : planRows.map(row => (
              <div
                key={`${row.facultyId}:${row.course}`}
                style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: `1px solid ${T.border}`, fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 700, color: T.text }}>
                  {FACULTY_SHORT_LABEL[row.facultyId]} · {row.course} курс
                </span>
                <span style={{ color: T.textMuted }}>{row.disciplines} дисциплин</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
