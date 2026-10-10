'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FACULTY_SHORT_LABEL } from '@/lib/facultyCodes';
import type { FacultyId } from '@/lib/groupRegistry';
import { LESSON_KIND_LABELS, type LessonKind } from '@/lib/curriculumLabels';
// Только типы: значения из curriculum тянут в бандл все планы кафедр.
import type { Lesson, Program, ProgramSummary } from '@/lib/curriculum';
import { shortFio, type RosterGroup } from '@/lib/roster';

const T = {
  surface:     '#FFFFFF',
  surfaceAlt:  '#FAF8F3',
  border:      '#E7E2D6',
  text:        '#1F1B14',
  textMuted:   '#6B6558',
  textFaint:   '#9A9485',
  accent:      '#1F7A6E',
  accentSoft:  '#E5F1EE',
  success:     '#3B7A48',
  successSoft: '#E4EFE3',
  warn:        '#A0741E',
  warnSoft:    '#F7EED7',
  danger:      '#9B3B3B',
  dangerSoft:  '#F3E4E4',
};

const FONT_SANS = 'var(--font-sans, system-ui, sans-serif)';
const FACULTY_IDS: FacultyId[] = ['stomatology', 'therapeutic', 'pediatrics'];

type Section = 'groups' | 'programs' | 'rosters';

interface GroupNode {
  digits: string;
  studyGroup: string;
  course: number;
  international?: boolean;
  note?: string;
}

interface TreeFaculty {
  facultyId: FacultyId;
  label: string;
  maxCourse: number;
  courses: { course: number; groups: GroupNode[] }[];
}

interface SubjectInfo {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  badge: string;
}

interface RosterOverview {
  studyGroup: string;
  facultyId: FacultyId;
  course: number;
  listed: number;
  updatedAt: string;
}

interface CurriculumState {
  tree: TreeFaculty[];
  hidden: Record<FacultyId, GroupNode[]>;
  programs: ProgramSummary[];
  groupPrograms: Record<string, string[]>;
  programGroupCounts: Record<string, number>;
  rosters: RosterOverview[];
  subjects: SubjectInfo[];
}

const EMPTY_STATE: CurriculumState = {
  tree: [],
  hidden: { stomatology: [], therapeutic: [], pediatrics: [] },
  programs: [],
  groupPrograms: {},
  programGroupCounts: {},
  rosters: [],
  subjects: [],
};

function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

/** Строки плана кафедры → занятия. «Контрольная …» и «Коллоквиум …» распознаются по началу строки. */
function parsePlanText(text: string): Array<Pick<Lesson, 'kind' | 'title' | 'summary'>> {
  const out: Array<Pick<Lesson, 'kind' | 'title' | 'summary'>> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const [titlePart, summaryPart] = line.split('|').map(s => s?.trim());
    const stripped = (titlePart ?? '')
      .replace(/^(?:занятие|тема|практическое занятие)\s*/iu, '')
      .replace(/^\d{1,3}\s*[.)]?\s*/u, '')
      .trim();
    if (!stripped) continue;

    let kind: LessonKind = 'lesson';
    if (/^(?:контрольн|итогов|зачёт|зачет|рубежн)/iu.test(stripped)) kind = 'control';
    if (/^коллоквиум/iu.test(stripped)) kind = 'colloquium';

    out.push({ kind, title: stripped, summary: summaryPart || undefined });
  }
  return out;
}

function makeLessonId(existing: Lesson[]): string {
  const used = new Set(existing.map(l => l.id));
  let i = existing.length + 1;
  while (used.has(`l${i}`)) i += 1;
  return `l${i}`;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const btn = (kind: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
  padding: '7px 12px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  border: kind === 'primary' ? 'none' : `1px solid ${T.border}`,
  background: kind === 'primary' ? T.accent : kind === 'danger' ? T.dangerSoft : T.surface,
  color: kind === 'primary' ? '#fff' : kind === 'danger' ? T.danger : T.textMuted,
});

const input: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  fontSize: 12,
  fontFamily: FONT_SANS,
  color: T.text,
  background: T.surface,
  width: '100%',
  boxSizing: 'border-box',
};

const card: React.CSSProperties = {
  background: T.surfaceAlt,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 12,
  marginBottom: 12,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  marginBottom: 6,
};

const hint: React.CSSProperties = {
  fontSize: 11,
  color: T.textFaint,
  lineHeight: 1.45,
  marginBottom: 8,
};

export default function AdminCurriculumTab({
  secret,
  showToast,
}: {
  secret: string;
  showToast: (msg: string) => void;
}) {
  const [state, setState] = useState<CurriculumState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<Section>('groups');
  const [facultyId, setFacultyId] = useState<FacultyId>('pediatrics');
  const [course, setCourse] = useState(2);

  const call = useCallback(async (
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | null> => {
    const initData = getTelegramInitData();
    if (!initData || !secret) {
      showToast('Нет доступа админа');
      return null;
    }
    try {
      const r = await fetch('/api/admin-curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, secret, initData, ...payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error || 'Ошибка'));
      return d as Record<string, unknown>;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка запроса');
      return null;
    }
  }, [secret, showToast]);

  const applyState = useCallback((d: Record<string, unknown> | null) => {
    if (!d || !d.tree) return;
    setState({
      tree: (d.tree as TreeFaculty[]) ?? [],
      hidden: (d.hidden as CurriculumState['hidden']) ?? EMPTY_STATE.hidden,
      programs: (d.programs as ProgramSummary[]) ?? [],
      groupPrograms: (d.groupPrograms as Record<string, string[]>) ?? {},
      programGroupCounts: (d.programGroupCounts as Record<string, number>) ?? {},
      rosters: (d.rosters as RosterOverview[]) ?? [],
      subjects: (d.subjects as SubjectInfo[]) ?? [],
    });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    applyState(await call('state'));
    setLoading(false);
  }, [call, applyState]);

  useEffect(() => { void reload(); }, [reload]);

  const faculty = useMemo(
    () => state.tree.find(f => f.facultyId === facultyId) ?? null,
    [state.tree, facultyId],
  );

  const courseGroups = useMemo(
    () => faculty?.courses.find(c => c.course === course)?.groups ?? [],
    [faculty, course],
  );

  const run = useCallback(async (
    action: string,
    payload: Record<string, unknown>,
    successMsg?: string,
  ) => {
    setBusy(true);
    const d = await call(action, payload);
    if (d) {
      applyState(d);
      if (successMsg) showToast(successMsg);
    }
    setBusy(false);
    return d;
  }, [call, applyState, showToast]);

  if (loading && state.tree.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 14 }}>
        Загрузка учебных планов…
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px 24px', fontFamily: FONT_SANS }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
        Занятия и планы кафедр
      </div>
      <div style={{ ...hint, marginBottom: 12 }}>
        Здесь состав групп, план занятий по предмету и списки деканата.
        Выдача доступа и оплата остались во вкладке «Группы».
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([
          { id: 'groups' as Section,   label: 'Группы курса' },
          { id: 'programs' as Section, label: 'Планы занятий' },
          { id: 'rosters' as Section,  label: 'Списки' },
        ]).map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              border: `1px solid ${section === s.id ? T.accent : T.border}`,
              background: section === s.id ? T.accentSoft : T.surfaceAlt,
              color: section === s.id ? T.accent : T.textMuted,
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Факультет и курс — общие для всех разделов */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {FACULTY_IDS.map(id => (
          <button
            key={id}
            type="button"
            onClick={() => setFacultyId(id)}
            style={{
              padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: 700,
              border: `1px solid ${facultyId === id ? T.accent : T.border}`,
              background: facultyId === id ? T.accentSoft : T.surfaceAlt,
              color: facultyId === id ? T.accent : T.textMuted,
              cursor: 'pointer',
            }}
          >
            {FACULTY_SHORT_LABEL[id]}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
        {Array.from({ length: faculty?.maxCourse ?? 5 }, (_, i) => i + 1).map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setCourse(c)}
            style={{
              padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600,
              border: `1px solid ${course === c ? T.accent : T.border}`,
              background: course === c ? T.accentSoft : T.surface,
              color: course === c ? T.accent : T.textFaint,
              cursor: 'pointer',
            }}
          >
            {c} курс
          </button>
        ))}
      </div>

      {section === 'groups' && (
        <GroupsSection
          course={course}
          groups={courseGroups}
          hidden={(state.hidden[facultyId] ?? []).filter(g => g.course === course)}
          rosters={state.rosters}
          groupPrograms={state.groupPrograms}
          busy={busy}
          onAdd={digits => run('add_group', { facultyId, digits }, `Группа ${digits} добавлена`)}
          onRemove={studyGroup => run('remove_group', { facultyId, studyGroup }, `${studyGroup} убрана`)}
          onRestore={studyGroup => run('restore_group', { studyGroup }, `${studyGroup} возвращена`)}
        />
      )}

      {section === 'programs' && (
        <ProgramsSection
          facultyId={facultyId}
          course={course}
          groups={courseGroups}
          state={state}
          busy={busy}
          call={call}
          run={run}
          showToast={showToast}
        />
      )}

      {section === 'rosters' && (
        <RostersSection
          facultyId={facultyId}
          course={course}
          groups={courseGroups}
          rosters={state.rosters.filter(r => r.facultyId === facultyId)}
          busy={busy}
          call={call}
          run={run}
          showToast={showToast}
        />
      )}

      <button
        type="button"
        onClick={() => void reload()}
        style={{ ...btn('ghost'), width: '100%', marginTop: 12, padding: 10 }}
      >
        Обновить данные
      </button>
    </div>
  );
}

// ─── Группы курса ────────────────────────────────────────────────────────────

function GroupsSection({
  course,
  groups,
  hidden,
  rosters,
  groupPrograms,
  busy,
  onAdd,
  onRemove,
  onRestore,
}: {
  course: number;
  groups: GroupNode[];
  hidden: GroupNode[];
  rosters: RosterOverview[];
  groupPrograms: Record<string, string[]>;
  busy: boolean;
  onAdd: (digits: string) => void;
  onRemove: (studyGroup: string) => void;
  onRestore: (studyGroup: string) => void;
}) {
  const [digits, setDigits] = useState('');
  const rosterByGroup = useMemo(
    () => new Map(rosters.map(r => [r.studyGroup, r])),
    [rosters],
  );

  return (
    <>
      <div style={card}>
        <div style={sectionTitle}>Добавить группу</div>
        <div style={hint}>
          Номер начинается с курса: 208 — второй курс, 315 — третий.
          Буква факультета дописывается сама.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={digits}
            onChange={e => setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder={`${course}08`}
            inputMode="numeric"
            style={{ ...input, flex: 1 }}
          />
          <button
            type="button"
            disabled={busy || digits.length < 3}
            onClick={() => { onAdd(digits); setDigits(''); }}
            style={{ ...btn('primary'), opacity: busy || digits.length < 3 ? 0.5 : 1 }}
          >
            Добавить
          </button>
        </div>
      </div>

      <div style={sectionTitle}>
        Группы {course} курса
        <span style={{ fontWeight: 500, color: T.textMuted, marginLeft: 6 }}>
          ({groups.length})
        </span>
      </div>
      <div style={hint}>
        Крестик убирает группу из сетки — она исчезнет и здесь, и в выдаче доступа.
        Список и число предметов показаны на плашке.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {groups.length === 0 && (
          <div style={{ fontSize: 12, color: T.textFaint, padding: 8 }}>
            На этом курсе групп нет — добавь номер выше.
          </div>
        )}
        {groups.map(g => {
          const roster = rosterByGroup.get(g.studyGroup);
          const programCount = (groupPrograms[g.studyGroup] ?? []).length;
          return (
            <div
              key={g.studyGroup}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 9,
                background: T.surface, border: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text, minWidth: 52 }}>
                {g.studyGroup}
              </span>
              {g.international && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                  background: T.warnSoft, color: T.warn,
                }}>
                  англ.
                </span>
              )}
              <span style={{ flex: 1, fontSize: 11, color: T.textFaint }}>
                {roster ? `в списке ${roster.listed}` : 'список не загружен'}
                {programCount > 0 && ` · планов: ${programCount}`}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(g.studyGroup)}
                title="Убрать группу из сетки"
                style={{ ...btn('danger'), padding: '5px 9px', opacity: busy ? 0.5 : 1 }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div style={card}>
          <div style={sectionTitle}>Убранные группы</div>
          <div style={hint}>Эти номера есть в официальных диапазонах, но скрыты.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {hidden.map(g => (
              <button
                key={g.studyGroup}
                type="button"
                disabled={busy}
                onClick={() => onRestore(g.studyGroup)}
                style={{ ...btn('ghost'), fontWeight: 600 }}
              >
                {g.studyGroup} ↩
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Планы занятий ───────────────────────────────────────────────────────────

function ProgramsSection({
  facultyId,
  course,
  groups,
  state,
  busy,
  call,
  run,
  showToast,
}: {
  facultyId: FacultyId;
  course: number;
  groups: GroupNode[];
  state: CurriculumState;
  busy: boolean;
  call: (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  run: (action: string, payload: Record<string, unknown>, msg?: string) => Promise<Record<string, unknown> | null>;
  showToast: (msg: string) => void;
}) {
  const [newSubject, setNewSubject] = useState('');
  const [editing, setEditing] = useState<Program | null>(null);

  const programs = useMemo(
    () => state.programs.filter(p => p.facultyId === facultyId && p.course === course),
    [state.programs, facultyId, course],
  );

  const usedSubjects = useMemo(() => new Set(programs.map(p => p.subjectId)), [programs]);
  const freeSubjects = useMemo(
    () => state.subjects.filter(s => !usedSubjects.has(s.id)),
    [state.subjects, usedSubjects],
  );

  useEffect(() => {
    if (!newSubject && freeSubjects.length > 0) setNewSubject(freeSubjects[0].id);
  }, [freeSubjects, newSubject]);

  const openProgram = async (programId: string) => {
    const d = await call('get_program', { programId });
    if (d?.program) setEditing(d.program as Program);
  };

  const createProgram = async () => {
    if (!newSubject) return;
    const d = await run('save_program', {
      facultyId,
      course,
      subjectId: newSubject,
      lessons: [],
    }, 'План создан');
    if (d?.program) setEditing(d.program as Program);
  };

  if (editing) {
    return (
      <ProgramEditor
        program={editing}
        groups={groups}
        groupPrograms={state.groupPrograms}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (lessons, meta) => {
          const d = await run('save_program', {
            facultyId: editing.facultyId,
            course: editing.course,
            subjectId: editing.subjectId,
            title: meta.title,
            sourceDoc: meta.sourceDoc,
            lessons,
          }, 'План сохранён');
          if (d?.program) setEditing(d.program as Program);
        }}
        onDelete={async () => {
          await run('delete_program', { programId: editing.id }, 'План удалён');
          setEditing(null);
        }}
        onToggleGroup={(studyGroup, enabled) => run(
          'set_group_program',
          { programId: editing.id, studyGroup, enabled },
        )}
        onAssignAll={() => run(
          'set_group_program',
          { programId: editing.id, studyGroups: groups.map(g => g.studyGroup), enabled: true },
          'План выдан всем группам курса',
        )}
        showToast={showToast}
      />
    );
  }

  return (
    <>
      <div style={card}>
        <div style={sectionTitle}>Новый план по предмету</div>
        <div style={hint}>
          План один на курс и факультет — все группы курса учатся по одному плану кафедры.
        </div>
        {freeSubjects.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textFaint }}>
            Планы созданы по всем предметам этого курса.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              style={{ ...input, flex: 1 }}
            >
              {freeSubjects.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !newSubject}
              onClick={() => void createProgram()}
              style={{ ...btn('primary'), opacity: busy ? 0.5 : 1 }}
            >
              Создать
            </button>
          </div>
        )}
      </div>

      <div style={sectionTitle}>Планы {course} курса</div>
      {programs.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textFaint, padding: 8 }}>
          Пока ни одного плана. Создай план и добавь занятия по документу кафедры.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {programs.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => void openProgram(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                padding: '10px 11px', borderRadius: 10, cursor: 'pointer',
                background: T.surface, border: `1px solid ${T.border}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  {p.subjectLabel}
                </div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
                  занятий: {p.lessonCount}
                  {p.controlCount > 0 && ` · контроль: ${p.controlCount}`}
                  {p.lectureCount > 0 && ` · лекций: ${p.lectureCount}`}
                  {' · групп: '}{state.programGroupCounts[p.id] ?? 0}
                </div>
                {p.builtIn && (
                  <div style={{ fontSize: 10.5, color: T.accent, marginTop: 3 }}>
                    план из файла проекта
                  </div>
                )}
              </div>
              <span style={{ fontSize: 16, color: T.textFaint }}>›</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Редактор плана ──────────────────────────────────────────────────────────

function ProgramEditor({
  program,
  groups,
  groupPrograms,
  busy,
  onClose,
  onSave,
  onDelete,
  onToggleGroup,
  onAssignAll,
  showToast,
}: {
  program: Program;
  groups: GroupNode[];
  groupPrograms: Record<string, string[]>;
  busy: boolean;
  onClose: () => void;
  onSave: (lessons: Lesson[], meta: { title: string; sourceDoc: string }) => void;
  onDelete: () => void;
  onToggleGroup: (studyGroup: string, enabled: boolean) => void;
  onAssignAll: () => void;
  showToast: (msg: string) => void;
}) {
  const [title, setTitle] = useState(program.title);
  const [sourceDoc, setSourceDoc] = useState(program.sourceDoc ?? '');
  const [lessons, setLessons] = useState<Lesson[]>(program.lessons);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planText, setPlanText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [showLectures, setShowLectures] = useState(false);

  useEffect(() => {
    setTitle(program.title);
    setSourceDoc(program.sourceDoc ?? '');
    setLessons(program.lessons);
  }, [program]);

  const dirty = useMemo(() => (
    JSON.stringify(lessons) !== JSON.stringify(program.lessons)
    || title !== program.title
    || sourceDoc !== (program.sourceDoc ?? '')
  ), [lessons, title, sourceDoc, program]);

  const patchLesson = (id: string, patch: Partial<Lesson>) => {
    setLessons(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addLesson = (kind: LessonKind) => {
    setLessons(prev => {
      const lesson: Lesson = {
        id: makeLessonId(prev),
        order: prev.length + 1,
        kind,
        title: '',
      };
      setOpenId(lesson.id);
      return [...prev, lesson];
    });
  };

  const applyPlanText = (mode: 'replace' | 'append') => {
    const parsed = parsePlanText(planText);
    if (parsed.length === 0) {
      showToast('Не нашёл ни одной строки с темой');
      return;
    }
    setLessons(prev => {
      const base = mode === 'replace' ? [] : prev;
      const next = [...base];
      for (const item of parsed) {
        next.push({
          id: makeLessonId(next),
          order: next.length + 1,
          kind: item.kind,
          title: item.title,
          summary: item.summary,
        });
      }
      return next.map((l, i) => ({ ...l, order: i + 1 }));
    });
    setPlanText('');
    setShowPaste(false);
    showToast(`Добавлено пунктов: ${parsed.length}`);
  };

  const assignedGroups = useMemo(
    () => new Set(groups.filter(g => (groupPrograms[g.studyGroup] ?? []).includes(program.id))
      .map(g => g.studyGroup)),
    [groups, groupPrograms, program.id],
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={onClose} style={btn('ghost')}>‹ Назад</button>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>
          {program.title}
        </div>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => onSave(lessons, { title, sourceDoc })}
          style={{ ...btn('primary'), opacity: busy || !dirty ? 0.45 : 1 }}
        >
          {dirty ? 'Сохранить' : 'Сохранено'}
        </button>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              Название плана
            </div>
            <input value={title} onChange={e => setTitle(e.target.value)} style={input} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              Документ кафедры
            </div>
            <input
              value={sourceDoc}
              onChange={e => setSourceDoc(e.target.value)}
              placeholder="Календарный план анатомии, 2025/26"
              style={input}
            />
          </div>
        </div>
      </div>

      {/* Группы курса */}
      <div style={card}>
        <div style={sectionTitle}>Кому этот план</div>
        <div style={hint}>
          Отметь группы, которые учатся по этому плану. Занятия у них пойдут по порядку.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {groups.map(g => {
            const on = assignedGroups.has(g.studyGroup);
            return (
              <button
                key={g.studyGroup}
                type="button"
                disabled={busy}
                onClick={() => onToggleGroup(g.studyGroup, !on)}
                style={{
                  padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${on ? T.success : T.border}`,
                  background: on ? T.successSoft : T.surface,
                  color: on ? T.success : T.textMuted,
                  cursor: 'pointer',
                }}
              >
                {g.studyGroup}
              </button>
            );
          })}
        </div>
        {groups.length > 0 && (
          <button type="button" disabled={busy} onClick={onAssignAll} style={btn('ghost')}>
            Отметить все группы курса
          </button>
        )}
      </div>

      {program.lectures.length > 0 && (
        <div style={card}>
          <button
            type="button"
            onClick={() => setShowLectures(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              textAlign: 'left', fontFamily: FONT_SANS,
            }}
          >
            <span style={{ ...sectionTitle, marginBottom: 0, flex: 1 }}>
              Лекции
              <span style={{ fontWeight: 500, color: T.textMuted, marginLeft: 6 }}>
                ({program.lectures.length})
              </span>
            </span>
            <span style={{ fontSize: 12, color: T.textFaint }}>
              {showLectures ? '▲' : '▼'}
            </span>
          </button>
          {showLectures && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={hint}>
                Лекции идут из документа кафедры и служат фоном к занятиям.
                Правятся в файле плана, а не здесь.
              </div>
              {program.lectures.map(lec => (
                <div
                  key={lec.id}
                  style={{
                    display: 'flex', gap: 8, padding: '7px 9px', borderRadius: 8,
                    background: T.surface, border: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: T.textFaint, minWidth: 20,
                  }}>
                    {lec.planNumber ?? lec.order}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: T.text, lineHeight: 1.4 }}>
                    {lec.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Занятия */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ ...sectionTitle, marginBottom: 0, flex: 1 }}>
          Занятия
          <span style={{ fontWeight: 500, color: T.textMuted, marginLeft: 6 }}>
            ({lessons.length})
          </span>
        </div>
        <button type="button" onClick={() => setShowPaste(v => !v)} style={btn('ghost')}>
          План текстом
        </button>
      </div>

      {showPaste && (
        <div style={card}>
          <div style={hint}>
            Одна строка — один пункт плана. Номера в начале строки можно оставить, они срежутся.
            Строка, начинающаяся со слова «Контрольная» или «Коллоквиум», станет контрольной точкой.
            Через <b>|</b> можно сразу дать короткое объяснение темы.
          </div>
          <textarea
            value={planText}
            onChange={e => setPlanText(e.target.value)}
            rows={7}
            placeholder={'1. Кости черепа | что запомнить к паре\n2. Мышцы головы\nКонтрольная по костям черепа'}
            style={{ ...input, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => applyPlanText('append')} style={btn('primary')}>
              Добавить в конец
            </button>
            <button type="button" onClick={() => applyPlanText('replace')} style={btn('ghost')}>
              Заменить весь план
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {lessons.length === 0 && (
          <div style={{ fontSize: 12, color: T.textFaint, padding: 8 }}>
            Занятий пока нет. Вставь план текстом или добавь пункт вручную.
          </div>
        )}
        {lessons.map((lesson, i) => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            open={openId === lesson.id}
            busy={busy}
            onToggleOpen={() => setOpenId(openId === lesson.id ? null : lesson.id)}
            onPatch={patch => patchLesson(lesson.id, patch)}
            onMove={dir => setLessons(prev => moveItem(prev, i, i + dir).map((l, idx) => ({
              ...l, order: idx + 1,
            })))}
            onRemove={() => setLessons(prev => prev
              .filter(l => l.id !== lesson.id)
              .map((l, idx) => ({ ...l, order: idx + 1 })))}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" onClick={() => addLesson('lesson')} style={btn('ghost')}>
          + Занятие
        </button>
        <button type="button" onClick={() => addLesson('control')} style={btn('ghost')}>
          + Контрольная
        </button>
        <button type="button" onClick={() => addLesson('colloquium')} style={btn('ghost')}>
          + Коллоквиум
        </button>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Удалить план «${program.title}»? Занятия пропадут у всех групп.`)) {
            onDelete();
          }
        }}
        style={{ ...btn('danger'), width: '100%', padding: 10 }}
      >
        Удалить план
      </button>
    </>
  );
}

function LessonRow({
  lesson,
  open,
  busy,
  onToggleOpen,
  onPatch,
  onMove,
  onRemove,
}: {
  lesson: Lesson;
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onPatch: (patch: Partial<Lesson>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const isControl = lesson.kind !== 'lesson';
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${isControl ? T.warn + '55' : T.border}`,
      borderRadius: 10,
      padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          title={lesson.planNumber
            ? `Занятие ${lesson.order} курса · тема ${lesson.planNumber} по плану кафедры`
            : `Занятие ${lesson.order}`}
          style={{
            fontSize: 11, fontWeight: 800, minWidth: 24, textAlign: 'center',
            color: isControl ? T.warn : T.accent,
          }}
        >
          {lesson.planNumber ?? lesson.order}
        </span>
        <input
          value={lesson.title}
          onChange={e => onPatch({ title: e.target.value })}
          placeholder="Тема по плану кафедры"
          style={{ ...input, flex: 1, padding: '6px 8px' }}
        />
        <button type="button" onClick={onToggleOpen} style={{ ...btn('ghost'), padding: '5px 8px' }}>
          {open ? '▲' : '▼'}
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['lesson', 'control', 'colloquium'] as LessonKind[]).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => onPatch({ kind: k })}
                style={{
                  padding: '5px 9px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${lesson.kind === k ? T.accent : T.border}`,
                  background: lesson.kind === k ? T.accentSoft : T.surfaceAlt,
                  color: lesson.kind === k ? T.accent : T.textMuted,
                  cursor: 'pointer',
                }}
              >
                {LESSON_KIND_LABELS[k]}
              </button>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              Понятное объяснение
            </div>
            <textarea
              value={lesson.summary ?? ''}
              onChange={e => onPatch({ summary: e.target.value })}
              rows={3}
              placeholder="Что это за тема и зачем она нужна — простыми словами"
              style={{ ...input, resize: 'vertical' }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              Что уметь к паре (по строке на пункт)
            </div>
            <textarea
              value={(lesson.objectives ?? []).join('\n')}
              onChange={e => onPatch({
                objectives: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
              })}
              rows={3}
              style={{ ...input, resize: 'vertical' }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              Термины для карточек и «верно/неверно»
            </div>
            <textarea
              value={(lesson.terms ?? []).join('\n')}
              onChange={e => onPatch({
                terms: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
              })}
              rows={3}
              style={{ ...input, resize: 'vertical' }}
            />
          </div>

          {isControl && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
                Какие занятия входят (номера через запятую)
              </div>
              <input
                value={(lesson.covers ?? []).join(', ')}
                onChange={e => onPatch({
                  covers: e.target.value
                    .split(',')
                    .map(s => Number(s.trim()))
                    .filter(n => Number.isInteger(n) && n > 0),
                })}
                placeholder="1, 2, 3, 4"
                style={input}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" disabled={busy} onClick={() => onMove(-1)} style={btn('ghost')}>
              ↑ выше
            </button>
            <button type="button" disabled={busy} onClick={() => onMove(1)} style={btn('ghost')}>
              ↓ ниже
            </button>
            <div style={{ flex: 1 }} />
            <button type="button" disabled={busy} onClick={onRemove} style={btn('danger')}>
              Удалить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Списки деканата ─────────────────────────────────────────────────────────

function RostersSection({
  facultyId,
  course,
  groups,
  rosters,
  busy,
  call,
  run,
  showToast,
}: {
  facultyId: FacultyId;
  course: number;
  groups: GroupNode[];
  rosters: RosterOverview[];
  busy: boolean;
  call: (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  run: (action: string, payload: Record<string, unknown>, msg?: string) => Promise<Record<string, unknown> | null>;
  showToast: (msg: string) => void;
}) {
  const [digits, setDigits] = useState('');
  const [text, setText] = useState('');
  const [viewing, setViewing] = useState<{ roster: RosterGroup; accounts: number } | null>(null);

  const preview = useMemo(() => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    return lines.length;
  }, [text]);

  const courseRosters = useMemo(
    () => rosters.filter(r => r.course === course),
    [rosters, course],
  );

  const openRoster = async (studyGroup: string) => {
    const d = await call('get_roster', { studyGroup });
    if (d?.roster) {
      setViewing({
        roster: d.roster as RosterGroup,
        accounts: Number(d.accounts ?? 0),
      });
    }
  };

  if (viewing) {
    const { roster, accounts } = viewing;
    const overflow = accounts > roster.students.length;
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={() => setViewing(null)} style={btn('ghost')}>‹ Назад</button>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>
            Группа {roster.studyGroup}
          </div>
        </div>

        <div style={{
          ...card,
          background: overflow ? T.warnSoft : T.surfaceAlt,
          borderColor: overflow ? T.warn + '55' : T.border,
        }}>
          <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>
            В списке деканата: <b>{roster.students.length}</b>
            {' · '}аккаунтов с этой группой: <b>{accounts}</b>
          </div>
          {overflow && (
            <div style={{ fontSize: 11, color: T.warn, marginTop: 6, lineHeight: 1.45 }}>
              Аккаунтов больше, чем студентов в списке — возможно, доступ раздали за пределы группы.
            </div>
          )}
          {roster.specialty && (
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>
              {roster.specialty}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {roster.students.map(s => (
            <div
              key={`${s.n}-${s.fio}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 8,
                background: T.surface, border: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 11, color: T.textFaint, minWidth: 18 }}>{s.n}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: T.text }}>{shortFio(s.fio)}</span>
              {s.record && (
                <span style={{ fontSize: 10.5, color: T.textFaint, fontFamily: 'ui-monospace, monospace' }}>
                  {s.record}
                </span>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Удалить список группы ${roster.studyGroup}?`)) {
              void run('delete_roster', { studyGroup: roster.studyGroup }, 'Список удалён');
              setViewing(null);
            }
          }}
          style={{ ...btn('danger'), width: '100%', padding: 10 }}
        >
          Удалить список
        </button>
      </>
    );
  }

  return (
    <>
      <div style={card}>
        <div style={sectionTitle}>Загрузить список группы</div>
        <div style={hint}>
          Скопируй список из файла деканата целиком — вместе со строкой «Группа 208, …».
          Номер группы, ФИО, категорию и зачётку разберу сам. Студентам этот список не показывается.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={digits}
            onChange={e => setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="номер группы, если нет в тексте"
            inputMode="numeric"
            style={{ ...input, flex: 1 }}
          />
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={7}
          placeholder={'Группа 208, 31.05.03 Стоматология (очное, высшее образование, 5,00)\n№ Ф.И.О. Категория Зачетка\n1 Иванов Иван Иванович Внебюджет 25-с26'}
          style={{ ...input, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ flex: 1, fontSize: 11, color: T.textFaint }}>
            строк в тексте: {preview}
          </span>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={async () => {
              const d = await run('save_roster', { facultyId, digits, text });
              if (d?.saved) {
                const saved = d.saved as { studyGroup: string; count: number };
                const skipped = Array.isArray(d.skipped) ? d.skipped.length : 0;
                showToast(
                  `${saved.studyGroup}: ${saved.count} студентов`
                  + (skipped ? ` · не разобрано строк: ${skipped}` : ''),
                );
                setText('');
                setDigits('');
              }
            }}
            style={{ ...btn('primary'), opacity: busy || !text.trim() ? 0.5 : 1 }}
          >
            Сохранить список
          </button>
        </div>
      </div>

      <div style={sectionTitle}>
        Загруженные списки
        <span style={{ fontWeight: 500, color: T.textMuted, marginLeft: 6 }}>
          ({courseRosters.length})
        </span>
      </div>
      {courseRosters.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textFaint, padding: 8 }}>
          На этом курсе списков пока нет.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {courseRosters.map(r => (
            <button
              key={r.studyGroup}
              type="button"
              onClick={() => void openRoster(r.studyGroup)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                padding: '9px 11px', borderRadius: 10, cursor: 'pointer',
                background: T.surface, border: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text, minWidth: 52 }}>
                {r.studyGroup}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: T.textFaint }}>
                студентов: {r.listed}
              </span>
              <span style={{ fontSize: 16, color: T.textFaint }}>›</span>
            </button>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div style={{ ...hint, marginTop: 12 }}>
          Без списка: {groups
            .filter(g => !courseRosters.some(r => r.studyGroup === g.studyGroup))
            .map(g => g.studyGroup)
            .join(', ') || '—'}
        </div>
      )}
    </>
  );
}
