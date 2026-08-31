/**
 * Кафедра = предмет.
 *
 * Карточка общая для всех факультетов, у кого открыт subjectId: педиатр,
 * стоматолог и лечебник с анатомией видят одну и ту же кафедру.
 *
 * Как добавить следующую кафедру:
 *   1. Положи JSON в src/data/departments/{subjectId}.json (как anat.json)
 *   2. Пропиши его в PACKS ниже
 *   3. Карточка «Кафедра» сама появится в Занятиях и в Профиле
 */
import anat from '@/data/departments/anat.json';

export type StaffGroup = 'head' | 'professor' | 'associate' | 'teacher' | 'assistant' | 'lab';

export interface DepartmentStaff {
  name: string;
  role: string;
  group: StaffGroup;
}

export interface DepartmentTool {
  id: string;
  title: string;
  blurb: string;
  how: string[];
  androidUrl?: string;
  iosUrl?: string;
  webUrl?: string;
}

export interface Department {
  subjectId: string;
  name: string;
  index?: string;
  intro: string;
  address?: string;
  phone?: string;
  email?: string;
  hours?: string;
  mapUrl?: string;
  pageUrl?: string;
  staff: DepartmentStaff[];
  tools: DepartmentTool[];
}

export const STAFF_GROUP_ORDER: StaffGroup[] = [
  'head', 'professor', 'associate', 'teacher', 'assistant', 'lab',
];

export const STAFF_GROUP_LABEL: Record<StaffGroup, string> = {
  head: 'Заведующий',
  professor: 'Профессора',
  associate: 'Доценты',
  teacher: 'Преподаватели',
  assistant: 'Ассистенты',
  lab: 'Учебно-вспомогательный состав',
};

const PACKS: Record<string, Department> = {
  anat: anat as Department,
};

export function getDepartment(subjectId: string | undefined): Department | null {
  if (!subjectId) return null;
  return PACKS[subjectId] ?? null;
}

export function subjectHasDepartment(subjectId: string | undefined): boolean {
  return getDepartment(subjectId) != null;
}
