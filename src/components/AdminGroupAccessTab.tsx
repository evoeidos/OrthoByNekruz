'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FACULTY_SHORT_LABEL } from '@/lib/facultyCodes';
import type { FacultyId } from '@/lib/groupRegistry';
import { PREVIEW_MODULE_LABELS, type PreviewModule } from '@/lib/previewModules';

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

type DurationKind = 'unlimited' | 'hours' | 'days' | 'exam_day';
type ModuleId = 'questions' | 'tests' | 'tasks' | 'exam' | 'materials';
type LessonsAccess = 'show' | 'hide';

const CORE_MODULES: PreviewModule[] = ['questions', 'tests', 'tasks'];

interface CatalogSubject {
  id: string;
  modules: { id: PreviewModule; label: string; available: boolean }[];
}

function moduleOptionsForSubject(
  catalog: CatalogSubject[],
  subjectId: string,
): { id: PreviewModule; label: string; available: boolean }[] {
  const entry = catalog.find(s => s.id === subjectId);
  return CORE_MODULES.map(id => ({
    id,
    label: PREVIEW_MODULE_LABELS[id],
    available: entry?.modules.find(m => m.id === id)?.available ?? true,
  }));
}

/** Раздел доступен, если он есть хотя бы у одного из выбранных предметов. */
function moduleOptionsForSubjects(
  catalog: CatalogSubject[],
  subjectIds: string[],
): { id: PreviewModule; label: string; available: boolean }[] {
  const perSubject = subjectIds.map(id => moduleOptionsForSubject(catalog, id));
  return CORE_MODULES.map(id => ({
    id,
    label: PREVIEW_MODULE_LABELS[id],
    available: perSubject.length === 0
      || perSubject.some(opts => opts.find(m => m.id === id)?.available === true),
  }));
}

function defaultModulesForSubject(
  catalog: CatalogSubject[],
  subjectId: string,
): PreviewModule[] {
  return moduleOptionsForSubject(catalog, subjectId)
    .filter(m => m.available)
    .map(m => m.id);
}

interface SubjectState {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  enabled: boolean;
  active: boolean;
  modules: ModuleId[];
  durationKind: DurationKind;
  durationValue: number | null;
  examDate: string | null;
  note: string | null;
  expiresAt: string | null;
  lessonsRestricted: boolean;
}

interface GroupNode {
  digits: string;
  studyGroup: string;
  international?: boolean;
  note?: string;
  subjects: SubjectState[];
}

interface TreeFaculty {
  facultyId: FacultyId;
  label: string;
  maxCourse: number;
  courses: { course: number; groups: GroupNode[] }[];
}

function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp?.initData ?? '';
}

const MODULE_OPTS: { id: ModuleId; label: string }[] = [
  { id: 'questions', label: 'Вопросы' },
  { id: 'tests',     label: 'Тесты' },
  { id: 'tasks',     label: 'Задачи' },
  { id: 'exam',      label: 'Проверка' },
  { id: 'materials', label: 'Материалы' },
];

const DURATION_OPTS: { id: DurationKind; label: string }[] = [
  { id: 'unlimited', label: 'Без срока' },
  { id: 'hours',     label: 'Часы' },
  { id: 'days',      label: 'Дни' },
  { id: 'exam_day',  label: 'До конца дня экзамена' },
];

interface ActiveGroupRow {
  studyGroup: string;
  course: number;
  subjects: SubjectState[];
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'без срока';
  return new Date(expiresAt).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatModules(modules: ModuleId[]): string {
  const labels = new Map(MODULE_OPTS.map(m => [m.id, m.label]));
  return modules.map(m => labels.get(m) ?? m).join(', ');
}

const MODULE_SHORT: Record<PreviewModule, string> = {
  questions: 'В',
  tests:     'Т',
  tasks:     'З',
};

function ModuleShortBadges({ modules }: { modules: ModuleId[] }) {
  const set = new Set(modules);
  const open = CORE_MODULES.filter(m => set.has(m));
  if (!open.length) {
    return <span style={{ fontSize: 10, color: T.textFaint }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {open.map(m => (
        <span
          key={m}
          title={PREVIEW_MODULE_LABELS[m]}
          style={{
            fontSize: 10, fontWeight: 800, lineHeight: 1,
            minWidth: 16, padding: '3px 4px', borderRadius: 4,
            textAlign: 'center',
            background: T.accentSoft, color: T.accent,
            border: `1px solid ${T.accent}44`,
          }}
        >
          {MODULE_SHORT[m]}
        </span>
      ))}
    </span>
  );
}

export default function AdminGroupAccessTab({
  secret,
  showToast,
}: {
  secret: string;
  showToast: (msg: string) => void;
}) {
  const [tree, setTree] = useState<TreeFaculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [facultyId, setFacultyId] = useState<FacultyId>('stomatology');
  const [course, setCourse] = useState(2);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  /** null — все предметы. */
  const [bulkSubjects, setBulkSubjects] = useState<string[] | null>(null);
  const [bulkDuration, setBulkDuration] = useState<DurationKind>('unlimited');
  const [bulkDurationValue, setBulkDurationValue] = useState(24);
  const [bulkExamDate, setBulkExamDate] = useState('');
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [rulesScope, setRulesScope] = useState<'course' | 'faculty'>('course');
  const [catalog, setCatalog] = useState<CatalogSubject[]>([]);
  const [bulkModules, setBulkModules] = useState<PreviewModule[]>(['questions', 'tests', 'tasks']);
  const [bulkLessonsAccess, setBulkLessonsAccess] = useState<LessonsAccess>('show');
  const [confirmGlobal, setConfirmGlobal] = useState<'open' | 'close' | null>(null);
  const [confirmCloseScope, setConfirmCloseScope] = useState(false);

  const faculty = useMemo(
    () => tree.find(f => f.facultyId === facultyId) ?? null,
    [tree, facultyId],
  );

  const courseGroups = useMemo(
    () => faculty?.courses.find(c => c.course === course)?.groups ?? [],
    [faculty, course],
  );

  const selectedList = useMemo(
    () => [...selectedGroups],
    [selectedGroups],
  );

  const activeGroups = useMemo(() => {
    const rows: ActiveGroupRow[] = [];
    for (const c of faculty?.courses ?? []) {
      if (rulesScope === 'course' && c.course !== course) continue;
      for (const g of c.groups) {
        const subjects = g.subjects.filter(s => s.active);
        if (subjects.length) rows.push({ studyGroup: g.studyGroup, course: c.course, subjects });
      }
    }
    return rows.sort((a, b) =>
      Number(a.studyGroup.match(/^([0-9]+)/)?.[1] || 0)
      - Number(b.studyGroup.match(/^([0-9]+)/)?.[1] || 0));
  }, [faculty, course, rulesScope]);

  const activeRuleCount = useMemo(
    () => activeGroups.reduce((n, g) => n + g.subjects.length, 0),
    [activeGroups],
  );

  const allSubjects = useMemo(
    () => tree.find(f => f.courses[0]?.groups[0])?.courses[0]?.groups[0]?.subjects ?? [],
    [tree],
  );

  const effectiveBulkSubjects = useMemo(
    () => bulkSubjects ?? allSubjects.map(s => s.id),
    [bulkSubjects, allSubjects],
  );

  const visibleGroups = useMemo(() => {
    if (!showOnlyActive) return courseGroups;
    return courseGroups.filter(g => g.subjects.some(s => s.active));
  }, [courseGroups, showOnlyActive]);

  const allVisibleSelected = visibleGroups.length > 0
    && visibleGroups.every(g => selectedGroups.has(g.studyGroup));

  const facultyGroupCount = useMemo(
    () => faculty?.courses.reduce((n, c) => n + c.groups.length, 0) ?? 0,
    [faculty],
  );

  const allTreeGroupCount = useMemo(
    () => tree.reduce((n, f) => n + f.courses.reduce((m, c) => m + c.groups.length, 0), 0),
    [tree],
  );

  const allActiveCount = useMemo(
    () => tree.reduce((n, f) => n + f.courses.reduce((m, c) =>
      m + c.groups.reduce((k, g) => k + g.subjects.filter(s => s.active).length, 0), 0), 0),
    [tree],
  );

  const bulkModuleOptions = useMemo(
    () => moduleOptionsForSubjects(catalog, effectiveBulkSubjects),
    [catalog, effectiveBulkSubjects],
  );

  useEffect(() => {
    setBulkModules(bulkModuleOptions.filter(m => m.available).map(m => m.id));
  }, [bulkModuleOptions]);

  const toggleBulkSubject = (id: string) => {
    const cur = new Set(effectiveBulkSubjects);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    // Порядок как в списке предметов; снова все — обратно null.
    const next = allSubjects.map(s => s.id).filter(sid => cur.has(sid));
    setBulkSubjects(next.length === allSubjects.length ? null : next);
  };

  const loadTree = useCallback(async () => {
    const initData = getTelegramInitData();
    if (!initData || !secret) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin-group-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tree', secret, initData }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки');
      setTree(d.tree ?? []);
      setCatalog(d.catalog ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [secret, showToast]);

  useEffect(() => { void loadTree(); }, [loadTree]);

  const toggleGroup = (studyGroup: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(studyGroup)) next.delete(studyGroup);
      else next.add(studyGroup);
      return next;
    });
  };

  const selectRange = (from: number, to: number) => {
    const next = new Set<string>();
    for (const g of courseGroups) {
      const n = Number(g.digits);
      if (n >= from && n <= to) next.add(g.studyGroup);
    }
    setSelectedGroups(next);
  };

  const selectAllVisible = () => {
    setSelectedGroups(new Set(visibleGroups.map(g => g.studyGroup)));
  };

  const selectEntireFaculty = () => {
    const next = new Set<string>();
    for (const c of faculty?.courses ?? []) {
      for (const g of c.groups) next.add(g.studyGroup);
    }
    setSelectedGroups(next);
  };

  const setRule = async (
    studyGroup: string,
    subjectId: string,
    enabled: boolean,
    opts?: {
      durationKind?: DurationKind;
      durationValue?: number;
      examDate?: string;
      modules?: ModuleId[];
      lessonsRestricted?: boolean;
    },
  ) => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет initData'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin-group-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_rule',
          secret,
          initData,
          facultyId,
          studyGroup,
          subjectId,
          enabled,
          syncUsers: true,
          durationKind: opts?.durationKind ?? 'unlimited',
          durationValue: opts?.durationValue,
          examDate: opts?.examDate,
          modules: opts?.modules ?? ['questions', 'tests', 'tasks'],
          lessonsRestricted: opts?.lessonsRestricted ?? false,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setTree(d.tree ?? []);
      showToast(enabled
        ? `✓ Открыто (${d.synced ?? 0} студ.)`
        : `✕ Закрыто (${d.synced ?? 0} студ.)`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  /** Закрыть все предметы у списка групп текущего факультета. */
  const closeGroups = async (studyGroups: string[]) => {
    if (!studyGroups.length) return;
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет initData'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin-group-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_rules_bulk',
          secret,
          initData,
          facultyId,
          subjectIds: allSubjects.map(s => s.id),
          enabled: false,
          studyGroups,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setTree(d.tree ?? []);
      setConfirmCloseScope(false);
      showToast(`✕ Закрыто: ${d.updated ?? 0} групп · ${d.synced ?? 0} студ.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const bulkSet = async (enabled: boolean) => {
    if (selectedList.length === 0) {
      showToast('Выбери группы');
      return;
    }
    if (effectiveBulkSubjects.length === 0) {
      showToast('Выбери хотя бы один предмет');
      return;
    }
    if (enabled && bulkModules.length === 0) {
      showToast('Выбери хотя бы один раздел');
      return;
    }
    const initData = getTelegramInitData();
    if (!initData) return;
    setSaving(true);
    try {
      const r = await fetch('/api/admin-group-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_rules_bulk',
          secret,
          initData,
          facultyId,
          subjectIds: effectiveBulkSubjects,
          enabled,
          studyGroups: selectedList,
          syncUsers: true,
          durationKind: bulkDuration,
          durationValue: bulkDuration === 'hours' || bulkDuration === 'days'
            ? bulkDurationValue
            : undefined,
          examDate: bulkDuration === 'exam_day' ? bulkExamDate : undefined,
          modules: bulkModules,
          lessonsRestricted: bulkLessonsAccess === 'hide',
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setTree(d.tree ?? []);
      setSelectedGroups(new Set());
      showToast(`✓ ${enabled ? 'Открыто' : 'Закрыто'} для ${d.updated ?? 0} групп · ${d.synced ?? 0} студ.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const runGlobal = async (kind: 'open' | 'close') => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет initData'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin-group-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: kind === 'open' ? 'open_all_content' : 'close_all_content',
          secret,
          initData,
          confirm: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setTree(d.tree ?? []);
      setSelectedGroups(new Set());
      setConfirmGlobal(null);
      showToast(kind === 'open'
        ? `✓ Весь контент открыт: ${d.groups ?? 0} групп · ${d.subjects ?? 0} предметов · ${d.synced ?? 0} студ.`
        : `✕ Бесплатный доступ закрыт: ${d.closed ?? 0} правил · ${d.synced ?? 0} студ.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const singleGroup = useMemo(() => {
    if (selectedList.length !== 1) return null;
    const sg = selectedList[0];
    const inCourse = courseGroups.find(g => g.studyGroup === sg);
    if (inCourse) return inCourse;
    for (const c of faculty?.courses ?? []) {
      const found = c.groups.find(g => g.studyGroup === sg);
      if (found) return found;
    }
    return null;
  }, [selectedList, courseGroups, faculty]);

  if (loading && tree.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 14 }}>
        Загрузка сетки групп…
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px 24px', fontFamily: FONT_SANS }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
        Доступ по группам
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14, lineHeight: 1.45 }}>
        Включи предмет для группы — студенты получат полный доступ без пробы при вводе группы.
        Отметь группы, выбери предметы (по умолчанию все) и нажми «Открыть» или «Закрыть».
        Оплаченный доступ не снимается.
      </div>

      {/* Глобально: всем факультетам */}
      <div style={{
        background: T.warnSoft, border: `1px solid ${T.warn}55`,
        borderRadius: 12, padding: 12, marginBottom: 14,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          Все факультеты сразу
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.45, marginBottom: 10 }}>
          Сейчас открыто {allActiveCount} доступов (группа × предмет)
          {allTreeGroupCount > 0 && allSubjects.length > 0 && (
            <> из {allTreeGroupCount * allSubjects.length} возможных</>
          )}.
        </div>
        {confirmGlobal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.warn, lineHeight: 1.4 }}>
              {confirmGlobal === 'open'
                ? 'Открыть все предметы (все разделы, без срока) всем группам всех факультетов?'
                : `Закрыть бесплатный доступ всем группам всех факультетов (${allActiveCount})? Оплаченный доступ останется.`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => void runGlobal(confirmGlobal)}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none',
                  background: confirmGlobal === 'open' ? T.warn : T.danger,
                  color: '#fff', fontWeight: 700, fontSize: 13,
                  cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                {saving
                  ? (confirmGlobal === 'open' ? 'Открываем…' : 'Закрываем…')
                  : (confirmGlobal === 'open' ? 'Да, открыть всем' : 'Да, закрыть всем')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmGlobal(null)}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10,
                  border: `1px solid ${T.border}`, background: T.surface,
                  color: T.textMuted, fontWeight: 600, fontSize: 13,
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={saving || allTreeGroupCount === 0}
              onClick={() => setConfirmGlobal('open')}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none',
                background: T.warn, color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: saving || allTreeGroupCount === 0 ? 'default' : 'pointer',
                opacity: saving || allTreeGroupCount === 0 ? 0.6 : 1,
              }}
            >
              Открыть всё всем
            </button>
            <button
              type="button"
              disabled={saving || allActiveCount === 0}
              onClick={() => setConfirmGlobal('close')}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none',
                background: T.dangerSoft, color: T.danger, fontWeight: 700, fontSize: 13,
                cursor: saving || allActiveCount === 0 ? 'default' : 'pointer',
                opacity: saving || allActiveCount === 0 ? 0.6 : 1,
              }}
            >
              Закрыть всё всем
            </button>
          </div>
        )}
      </div>

      {/* Факультеты */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['stomatology', 'therapeutic', 'pediatrics'] as FacultyId[]).map(id => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setFacultyId(id); setSelectedGroups(new Set());
              setConfirmGlobal(null); setConfirmCloseScope(false);
            }}
            style={{
              padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
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

      {/* Активные доступы — по группам */}
      <div style={{
        background: T.surfaceAlt, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: 12, marginBottom: 14,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, marginBottom: 8, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
            Открыто
            <span style={{ fontWeight: 500, color: T.textMuted, marginLeft: 6 }}>
              {activeGroups.length} групп · {activeRuleCount} предм.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['course', 'faculty'] as const).map(scope => (
              <button
                key={scope}
                type="button"
                onClick={() => { setRulesScope(scope); setConfirmCloseScope(false); }}
                style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${rulesScope === scope ? T.accent : T.border}`,
                  background: rulesScope === scope ? T.accentSoft : T.surface,
                  color: rulesScope === scope ? T.accent : T.textFaint,
                  cursor: 'pointer',
                }}
              >
                {scope === 'course' ? `${course} курс` : 'весь факультет'}
              </button>
            ))}
          </div>
        </div>

        {activeGroups.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.45 }}>
            Нет открытых доступов{rulesScope === 'course' ? ` на ${course} курсе` : ''}.
          </div>
        ) : (
          <>
            {confirmCloseScope ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void closeGroups(activeGroups.map(g => g.studyGroup))}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none',
                    background: T.danger, color: '#fff', fontWeight: 700, fontSize: 12,
                    cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Закрываем…' : `Да, закрыть ${activeGroups.length} групп`}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmCloseScope(false)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8,
                    border: `1px solid ${T.border}`, background: T.surface,
                    color: T.textMuted, fontWeight: 600, fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmCloseScope(true)}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8, marginBottom: 8,
                  border: 'none', background: T.dangerSoft, color: T.danger,
                  fontWeight: 700, fontSize: 12,
                  cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                Закрыть всё {rulesScope === 'course'
                  ? `на ${course} курсе`
                  : `на факультете ${FACULTY_SHORT_LABEL[facultyId]}`}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {activeGroups.map(row => (
                <div
                  key={row.studyGroup}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8,
                    background: T.surface, border: `1px solid ${T.border}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGroups(new Set([row.studyGroup]));
                      if (row.course !== course) setCourse(row.course);
                    }}
                    title="Настроить группу по предметам"
                    style={{
                      padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      border: `1px solid ${T.border}`, background: T.surfaceAlt,
                      color: T.text, cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    {row.studyGroup}
                    {rulesScope === 'faculty' && (
                      <span style={{ fontWeight: 500, color: T.textFaint, marginLeft: 4 }}>
                        · {row.course} к.
                      </span>
                    )}
                  </button>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3, flex: 1, minWidth: 0 }}>
                    {row.subjects.length === allSubjects.length ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: T.success }}>
                        все предметы
                      </span>
                    ) : row.subjects.map(s => (
                      <span
                        key={s.id}
                        title={`${s.label} · ${formatModules(s.modules)} · ${formatExpiry(s.expiresAt)}`}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                          background: `${s.color}22`, color: s.color, lineHeight: 1.3,
                        }}
                      >
                        {s.shortLabel}
                      </span>
                    ))}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void closeGroups([row.studyGroup])}
                    style={{
                      padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      border: 'none', background: T.dangerSoft, color: T.danger,
                      cursor: saving ? 'default' : 'pointer', flexShrink: 0,
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    Закрыть
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Курс */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {Array.from({ length: faculty?.maxCourse ?? 5 }, (_, i) => i + 1).map(c => (
          <button
            key={c}
            type="button"
            onClick={() => { setCourse(c); setSelectedGroups(new Set()); }}
            style={{
              padding: '6px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600,
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

      {/* Быстрый выбор стом 2 курс 201–208 */}
      {facultyId === 'stomatology' && course === 2 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => selectRange(201, 208)}
            style={{
              flex: 1, minWidth: 140, padding: '8px 12px', borderRadius: 8, fontSize: 12,
              border: `1px dashed ${T.accent}`, background: T.accentSoft, color: T.accent,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            201с–208с
          </button>
          <button
            type="button"
            onClick={() => selectRange(209, 216)}
            style={{
              flex: 1, minWidth: 140, padding: '8px 12px', borderRadius: 8, fontSize: 12,
              border: `1px dashed ${T.accent}`, background: T.surfaceAlt, color: T.accent,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            209с–216с
          </button>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginBottom: 8, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
          Группы {course} курса
        </div>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: T.textMuted, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showOnlyActive}
            onChange={e => setShowOnlyActive(e.target.checked)}
          />
          только с доступом
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={visibleGroups.length === 0}
          onClick={selectAllVisible}
          style={{
            padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            border: `1px solid ${allVisibleSelected ? T.accent : T.border}`,
            background: allVisibleSelected ? T.accentSoft : T.surface,
            color: allVisibleSelected ? T.accent : T.textMuted,
            cursor: visibleGroups.length === 0 ? 'default' : 'pointer',
            opacity: visibleGroups.length === 0 ? 0.5 : 1,
          }}
        >
          {allVisibleSelected ? 'Все выбраны' : `Выбрать всё (${visibleGroups.length})`}
        </button>
        <button
          type="button"
          disabled={facultyGroupCount === 0}
          onClick={selectEntireFaculty}
          style={{
            padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
            border: `1px dashed ${T.accent}`, background: T.accentSoft, color: T.accent,
            cursor: facultyGroupCount === 0 ? 'default' : 'pointer',
            opacity: facultyGroupCount === 0 ? 0.5 : 1,
          }}
        >
          Весь факультет ({facultyGroupCount})
        </button>
        {selectedList.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedGroups(new Set())}
            style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              border: `1px solid ${T.border}`, background: T.surface,
              color: T.textMuted, cursor: 'pointer',
            }}
          >
            Сбросить ({selectedList.length})
          </button>
        )}
      </div>

      {/* Группы */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14,
        maxHeight: 200, overflowY: 'auto', padding: 4,
      }}>
        {visibleGroups.length === 0 && (
          <div style={{ fontSize: 12, color: T.textFaint, padding: 8 }}>
            {showOnlyActive ? 'Нет групп с открытым доступом на этом курсе.' : 'Нет групп.'}
          </div>
        )}
        {visibleGroups.map(g => {
          const on = selectedGroups.has(g.studyGroup);
          const activeSubs = g.subjects.filter(s => s.active);
          const hasAccess = activeSubs.length > 0;
          return (
            <button
              key={g.studyGroup}
              type="button"
              onClick={() => toggleGroup(g.studyGroup)}
              style={{
                padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${on ? T.accent : hasAccess ? T.success : T.border}`,
                background: on ? T.accentSoft : hasAccess ? T.successSoft : T.surface,
                color: on ? T.accent : T.text,
                cursor: 'pointer',
                opacity: g.international ? 0.85 : 1,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                minWidth: 56,
              }}
              title={[
                g.international ? 'Иностранцы (англ.)' : '',
                hasAccess
                  ? activeSubs.map(s => s.label).join(', ')
                  : 'Доступ не открыт',
              ].filter(Boolean).join(' · ')}
            >
              <span>
                {g.studyGroup}{g.international ? ' 🌐' : ''}
              </span>
              {activeSubs.length > 0 && (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {activeSubs.map(s => (
                    <span
                      key={s.id}
                      style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 4,
                        background: `${s.color}22`, color: s.color, lineHeight: 1.3,
                      }}
                    >
                      {s.shortLabel}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Массовое действие */}
      {selectedList.length > 0 && (
        <div style={{
          background: T.surfaceAlt, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: 12, marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Выбрано групп: {selectedList.length}
          </div>
          <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 8, lineHeight: 1.4 }}>
            Действие применяется к отмеченным группам и выбранным предметам.
            {selectedList.length > courseGroups.filter(g => selectedGroups.has(g.studyGroup)).length && (
              <> В выбор входят группы других курсов этого факультета.</>
            )}
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6,
            }}>
              <span>Предметы ({effectiveBulkSubjects.length} из {allSubjects.length})</span>
              <button
                type="button"
                disabled={saving}
                onClick={() => setBulkSubjects(bulkSubjects === null ? [] : null)}
                style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${T.border}`, background: T.surface,
                  color: T.accent, cursor: 'pointer',
                }}
              >
                {bulkSubjects === null ? 'Снять все' : 'Выбрать все'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allSubjects.map(s => {
                const on = effectiveBulkSubjects.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={saving}
                    onClick={() => toggleBulkSubject(s.id)}
                    style={{
                      padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      border: `1px solid ${on ? s.color : T.border}`,
                      background: on ? `${s.color}1A` : T.surface,
                      color: on ? s.color : T.textFaint,
                      cursor: saving ? 'default' : 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <select
              value={bulkDuration}
              onChange={e => setBulkDuration(e.target.value as DurationKind)}
              style={{ flex: 1, minWidth: 120, padding: 8, borderRadius: 8, border: `1px solid ${T.border}` }}
            >
              {DURATION_OPTS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {(bulkDuration === 'hours' || bulkDuration === 'days') && (
              <input
                type="number"
                min={1}
                value={bulkDurationValue}
                onChange={e => setBulkDurationValue(Number(e.target.value) || 1)}
                style={{ width: 72, padding: 8, borderRadius: 8, border: `1px solid ${T.border}` }}
              />
            )}
            {bulkDuration === 'exam_day' && (
              <input
                type="date"
                value={bulkExamDate}
                onChange={e => setBulkExamDate(e.target.value)}
                style={{ padding: 8, borderRadius: 8, border: `1px solid ${T.border}` }}
              />
            )}
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
              Разделы предмета
            </div>
            <ModulePicker
              options={bulkModuleOptions}
              selected={bulkModules}
              onChange={setBulkModules}
              disabled={saving}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
              Вкладка «Занятия»
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['show', 'hide'] as LessonsAccess[]).map(v => (
                <button
                  key={v}
                  type="button"
                  disabled={saving}
                  onClick={() => setBulkLessonsAccess(v)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${bulkLessonsAccess === v ? (v === 'hide' ? '#C0392B' : T.accent) : T.border}`,
                    background: bulkLessonsAccess === v ? (v === 'hide' ? '#FDECEA' : T.accentSoft) : T.surfaceAlt,
                    color: bulkLessonsAccess === v ? (v === 'hide' ? '#C0392B' : T.accent) : T.textMuted,
                    cursor: saving ? 'default' : 'pointer',
                  }}
                >
                  {v === 'show' ? '✓ Показать' : '✗ Скрыть'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={saving || bulkModules.length === 0 || effectiveBulkSubjects.length === 0}
              onClick={() => void bulkSet(true)}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none',
                background: T.accent, color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              Открыть
            </button>
            <button
              type="button"
              disabled={saving || effectiveBulkSubjects.length === 0}
              onClick={() => void bulkSet(false)}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10,
                border: 'none', background: T.dangerSoft,
                color: T.danger, fontWeight: 700, fontSize: 13,
                cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Одна группа — детальная настройка по предметам */}
      {singleGroup && (
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: 12,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginBottom: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              Группа {singleGroup.studyGroup}
              {singleGroup.international && (
                <span style={{ fontSize: 11, color: T.warn, fontWeight: 500 }}> · иностранцы</span>
              )}
            </div>
            {singleGroup.subjects.some(s => s.active) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void closeGroups([singleGroup.studyGroup])}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  border: 'none', background: T.dangerSoft, color: T.danger,
                  cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                Закрыть все предметы
              </button>
            )}
          </div>
          {singleGroup.subjects.map(subj => (
            <SubjectRow
              key={subj.id}
              subj={subj}
              moduleOptions={moduleOptionsForSubject(catalog, subj.id)}
              saving={saving}
              onToggle={enabled => void setRule(singleGroup.studyGroup, subj.id, enabled, {
                durationKind: subj.durationKind,
                durationValue: subj.durationValue ?? undefined,
                examDate: subj.examDate ?? undefined,
                modules: subj.modules,
                lessonsRestricted: subj.lessonsRestricted,
              })}
              onSave={(enabled, opts) => void setRule(singleGroup.studyGroup, subj.id, enabled, opts)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void loadTree()}
        style={{
          marginTop: 14, width: '100%', padding: 10, borderRadius: 10,
          border: `1px solid ${T.border}`, background: T.surfaceAlt,
          color: T.textMuted, fontSize: 12, cursor: 'pointer',
        }}
      >
        Обновить список
      </button>
    </div>
  );
}

function ModulePicker({
  options,
  selected,
  onChange,
  disabled,
}: {
  options: { id: PreviewModule; label: string; available: boolean }[];
  selected: PreviewModule[];
  onChange: (next: PreviewModule[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: PreviewModule, available: boolean) => {
    if (!available || disabled) return;
    onChange(
      selected.includes(id)
        ? selected.filter(m => m !== id)
        : [...selected, id],
    );
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(m => {
        const on = selected.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled || !m.available}
            onClick={() => toggle(m.id, m.available)}
            title={m.available ? undefined : 'Нет данных для этого раздела'}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: `1px solid ${on ? T.accent : T.border}`,
              background: on ? T.accentSoft : T.surfaceAlt,
              color: !m.available ? T.textFaint : on ? T.accent : T.textMuted,
              cursor: disabled || !m.available ? 'default' : 'pointer',
              opacity: m.available ? 1 : 0.45,
              textDecoration: m.available ? 'none' : 'line-through',
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function SubjectRow({
  subj,
  moduleOptions,
  saving,
  onToggle,
  onSave,
}: {
  subj: SubjectState;
  moduleOptions: { id: PreviewModule; label: string; available: boolean }[];
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onSave: (enabled: boolean, opts: {
    durationKind: DurationKind;
    durationValue?: number;
    examDate?: string;
    modules: ModuleId[];
    lessonsRestricted: boolean;
  }) => void;
}) {
  const [durationKind, setDurationKind] = useState<DurationKind>(subj.durationKind);
  const [durationValue, setDurationValue] = useState(subj.durationValue ?? 24);
  const [examDate, setExamDate] = useState(subj.examDate ?? '');
  const [modules, setModules] = useState<PreviewModule[]>(
    subj.modules.filter((m): m is PreviewModule => CORE_MODULES.includes(m as PreviewModule)),
  );
  const [lessonsRestricted, setLessonsRestricted] = useState(subj.lessonsRestricted);

  useEffect(() => {
    setDurationKind(subj.durationKind);
    setDurationValue(subj.durationValue ?? 24);
    setExamDate(subj.examDate ?? '');
    const core = subj.modules.filter((m): m is PreviewModule => CORE_MODULES.includes(m as PreviewModule));
    setModules(core.length ? core : defaultModulesForSubject(
      [{ id: subj.id, modules: moduleOptions }],
      subj.id,
    ));
    setLessonsRestricted(subj.lessonsRestricted);
  }, [subj, moduleOptions]);

  return (
    <div style={{
      borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: subj.color }}>{subj.label}</span>
          {subj.active && (
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 700,
              padding: '2px 6px', borderRadius: 5,
              background: T.successSoft, color: T.success,
            }}>
              открыт
            </span>
          )}
        </div>
        {subj.active ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => onToggle(false)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              border: 'none', background: T.dangerSoft, color: T.danger,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Закрыть доступ
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(true, {
              durationKind,
              durationValue: durationKind === 'hours' || durationKind === 'days' ? durationValue : undefined,
              examDate: durationKind === 'exam_day' ? examDate : undefined,
              modules,
              lessonsRestricted,
            })}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              border: `1px solid ${T.border}`, background: T.surfaceAlt,
              color: T.textMuted, cursor: saving ? 'default' : 'pointer',
            }}
          >
            Открыть доступ
          </button>
        )}
      </div>
      {subj.active && (
        <div style={{ marginTop: 8, fontSize: 11, color: T.textFaint }}>
          {formatExpiry(subj.expiresAt)} · {formatModules(subj.modules)}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
          Разделы
        </div>
        <ModulePicker
          options={moduleOptions}
          selected={modules}
          onChange={setModules}
          disabled={saving}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
          Вкладка «Занятия»
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['show', 'hide'] as LessonsAccess[]).map(v => (
            <button
              key={v}
              type="button"
              disabled={saving}
              onClick={() => setLessonsRestricted(v === 'hide')}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: `1px solid ${(v === 'hide' ? lessonsRestricted : !lessonsRestricted) ? (v === 'hide' ? '#C0392B' : T.accent) : T.border}`,
                background: (v === 'hide' ? lessonsRestricted : !lessonsRestricted) ? (v === 'hide' ? '#FDECEA' : T.accentSoft) : T.surfaceAlt,
                color: (v === 'hide' ? lessonsRestricted : !lessonsRestricted) ? (v === 'hide' ? '#C0392B' : T.accent) : T.textMuted,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {v === 'show' ? '✓ Показать' : '✗ Скрыть'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        <select
          value={durationKind}
          onChange={e => setDurationKind(e.target.value as DurationKind)}
          style={{ flex: 1, minWidth: 100, padding: 6, borderRadius: 8, fontSize: 11, border: `1px solid ${T.border}` }}
        >
          {DURATION_OPTS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {(durationKind === 'hours' || durationKind === 'days') && (
          <input
            type="number"
            min={1}
            value={durationValue}
            onChange={e => setDurationValue(Number(e.target.value) || 1)}
            style={{ width: 56, padding: 6, borderRadius: 8, fontSize: 11, border: `1px solid ${T.border}` }}
          />
        )}
        {durationKind === 'exam_day' && (
          <input
            type="date"
            value={examDate}
            onChange={e => setExamDate(e.target.value)}
            style={{ padding: 6, borderRadius: 8, fontSize: 11, border: `1px solid ${T.border}` }}
          />
        )}
        <button
          type="button"
          disabled={saving || modules.length === 0}
          onClick={() => onSave(true, {
            durationKind,
            durationValue: durationKind === 'hours' || durationKind === 'days' ? durationValue : undefined,
            examDate: durationKind === 'exam_day' ? examDate : undefined,
            modules,
            lessonsRestricted,
          })}
          style={{
            padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
            border: 'none', background: T.accent, color: '#fff',
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
