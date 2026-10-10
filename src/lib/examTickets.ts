// ТОЛЬКО ДЛЯ СЕРВЕРА: модуль импортирует JSON билетов с ответами. Импорт из
// клиентского компонента положит их в публичный JS-бандл. Клиент получает
// билеты через /api/subject-data (type: 'tickets'), подписи — из examTicketLabels.
import orthoTicketsData from '@/data/ticketsData.json';
import pharmaTicketsData from '@/data/pharma_tickets.json';
import microTicketsData from '@/data/micro_tickets.json';
import chemTicketsData from '@/data/chem_tickets.json';

export interface ExamRawItem {
  id: number | string;
  question: string;
  answer: string;
}

export interface ExamTicket {
  id: number | string;
  ticketNumber: string | number;
  questions: ExamRawItem[];
  task: ExamRawItem;
  /** Собран из неиспользованных вопросов/задач (нет данных от студентов). */
  isRandom?: boolean;
}

type DataItem = {
  id?: number | string;
  question?: string;
  answer?: string;
  visible?: boolean;
};

import { getQuestionsPerTicket } from '@/lib/examTicketLabels';

export {
  EXAM_QUESTIONS_PER_TICKET_THRESHOLD,
  getQuestionsPerTicket,
  getExamTicketCompositionLabel,
} from '@/lib/examTicketLabels';

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  const out = [...arr];
  const rnd = seededRandom(hashSeed(seedStr));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toRawItem(item: DataItem, fallbackId: string): ExamRawItem {
  return {
    id: item.id ?? fallbackId,
    question: String(item.question || '').trim(),
    answer: String(item.answer || '').trim(),
  };
}

function normalizePool(items: unknown[]): ExamRawItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((raw): raw is DataItem => raw != null && typeof raw === 'object')
    .filter(item => item.visible !== false)
    .map(item => toRawItem(item, 'item'))
    .filter(item => item.question.length > 0);
}

/** Случайные билеты из пула вопросов и задач (стабильный набор на предмет). */
export function buildRandomExamTickets(
  subjectId: string,
  questions: unknown[],
  tasks: unknown[],
): ExamTicket[] {
  const qPool = normalizePool(questions);
  const tPool = normalizePool(tasks);
  const qPerTicket = getQuestionsPerTicket(qPool.length);
  const ticketCount = Math.min(Math.floor(qPool.length / qPerTicket), tPool.length);
  if (ticketCount < 1) return [];

  const shuffledQ = seededShuffle(qPool, `${subjectId}:exam:questions:${qPerTicket}`);
  const shuffledT = seededShuffle(tPool, `${subjectId}:exam:tasks`);

  const tickets: ExamTicket[] = [];
  for (let i = 0; i < ticketCount; i++) {
    const ticketQuestions: ExamRawItem[] = [];
    for (let j = 0; j < qPerTicket; j++) {
      const q = shuffledQ[i * qPerTicket + j];
      ticketQuestions.push({ ...q, id: q.id ?? `${i + 1}_q${j + 1}` });
    }
    const task = shuffledT[i];
    tickets.push({
      id: i + 1,
      ticketNumber: String(i + 1),
      questions: ticketQuestions,
      task: { ...task, id: task.id ?? `${i + 1}_task` },
    });
  }
  return tickets;
}

/** Предметы с официальными фиксированными билетами (не случайная сборка). */
export const OFFICIAL_EXAM_TICKET_SUBJECTS = new Set(['ortho', 'pharma', 'micro', 'chem']);

/** KrasGMU pharma / micro: 2 вопроса + задача. */
export const PHARMA_EXAM_TICKET_TOTAL = 40;
export const MICRO_EXAM_TICKET_TOTAL = 40;
export const CHEM_EXAM_TICKET_TOTAL = 35;
export const PHARMA_QUESTIONS_PER_TICKET = 2;
export const MICRO_QUESTIONS_PER_TICKET = 2;
export const CHEM_QUESTIONS_PER_TICKET = 2;

function collectOfficialUsedIds(official: ExamTicket[]): { qIds: Set<string>; tIds: Set<string> } {
  const qIds = new Set<string>();
  const tIds = new Set<string>();
  for (const ticket of official) {
    for (const q of ticket.questions) qIds.add(String(q.id));
    tIds.add(String(ticket.task.id));
  }
  return { qIds, tIds };
}

/** Официальные билеты + заполнители из неиспользованных вопросов/задач. */
export function buildPharmaExamTickets(
  questions: unknown[],
  tasks: unknown[],
): ExamTicket[] {
  const official = (pharmaTicketsData as ExamTicket[]).slice();
  const officialByNumber = new Map<number, ExamTicket>();
  for (const ticket of official) {
    officialByNumber.set(Number(ticket.ticketNumber), ticket);
  }

  const { qIds: usedQ, tIds: usedT } = collectOfficialUsedIds(official);
  const qPool = normalizePool(questions).filter(q => !usedQ.has(String(q.id)));
  const tPool = normalizePool(tasks).filter(t => !usedT.has(String(t.id)));

  const missing: number[] = [];
  for (let n = 1; n <= PHARMA_EXAM_TICKET_TOTAL; n++) {
    if (!officialByNumber.has(n)) missing.push(n);
  }

  const shuffledQ = seededShuffle(qPool, 'pharma:fill:questions');
  const shuffledT = seededShuffle(tPool, 'pharma:fill:tasks');

  const result: ExamTicket[] = [];
  for (let n = 1; n <= PHARMA_EXAM_TICKET_TOTAL; n++) {
    const fixed = officialByNumber.get(n);
    if (fixed) {
      result.push({ ...fixed, isRandom: false });
      continue;
    }

    const fillIdx = missing.indexOf(n);
    const qStart = fillIdx * PHARMA_QUESTIONS_PER_TICKET;
    const ticketQuestions = shuffledQ.slice(qStart, qStart + PHARMA_QUESTIONS_PER_TICKET);
    const task = shuffledT.length > 0 ? shuffledT[fillIdx % shuffledT.length] : null;

    if (ticketQuestions.length < PHARMA_QUESTIONS_PER_TICKET || !task) continue;

    result.push({
      id: n,
      ticketNumber: String(n),
      isRandom: true,
      questions: ticketQuestions.map((q, j) => ({
        ...q,
        id: q.id ?? `r${n}_q${j + 1}`,
      })),
      task: { ...task, id: task.id ?? `r${n}_task` },
    });
  }

  return result;
}

/** Официальные билеты микробиологии (Telegram) + заполнители из пула. */
export function buildMicroExamTickets(
  questions: unknown[],
  tasks: unknown[],
): ExamTicket[] {
  const official = (microTicketsData as ExamTicket[]).slice();
  const officialByNumber = new Map<number, ExamTicket>();
  for (const ticket of official) {
    officialByNumber.set(Number(ticket.ticketNumber), ticket);
  }

  const { qIds: usedQ, tIds: usedT } = collectOfficialUsedIds(official);
  const qPool = normalizePool(questions).filter(q => !usedQ.has(String(q.id)));
  const tPool = normalizePool(tasks).filter(t => !usedT.has(String(t.id)));

  const missing: number[] = [];
  for (let n = 1; n <= MICRO_EXAM_TICKET_TOTAL; n++) {
    if (!officialByNumber.has(n)) missing.push(n);
  }

  const shuffledQ = seededShuffle(qPool, 'micro:fill:questions');
  const shuffledT = seededShuffle(tPool, 'micro:fill:tasks');

  const result: ExamTicket[] = [];
  for (let n = 1; n <= MICRO_EXAM_TICKET_TOTAL; n++) {
    const fixed = officialByNumber.get(n);
    if (fixed) {
      result.push({ ...fixed, isRandom: false });
      continue;
    }

    const fillIdx = missing.indexOf(n);
    const qStart = fillIdx * MICRO_QUESTIONS_PER_TICKET;
    const ticketQuestions = shuffledQ.slice(qStart, qStart + MICRO_QUESTIONS_PER_TICKET);
    const task = shuffledT.length > 0 ? shuffledT[fillIdx % shuffledT.length] : null;

    if (ticketQuestions.length < MICRO_QUESTIONS_PER_TICKET || !task) continue;

    result.push({
      id: n,
      ticketNumber: String(n),
      isRandom: true,
      questions: ticketQuestions.map((q, j) => ({
        ...q,
        id: q.id ?? `r${n}_q${j + 1}`,
      })),
      task: { ...task, id: task.id ?? `r${n}_task` },
    });
  }

  return result;
}

/** Официальные билеты химии (docx) + заполнители из пула. */
export function buildChemExamTickets(
  questions: unknown[],
  tasks: unknown[],
): ExamTicket[] {
  const official = (chemTicketsData as ExamTicket[]).slice();
  const officialByNumber = new Map<number, ExamTicket>();
  for (const ticket of official) {
    officialByNumber.set(Number(ticket.ticketNumber), ticket);
  }

  const { qIds: usedQ, tIds: usedT } = collectOfficialUsedIds(official);
  const qPool = normalizePool(questions).filter(q => !usedQ.has(String(q.id)));
  const tPool = normalizePool(tasks).filter(t => !usedT.has(String(t.id)));

  const missing: number[] = [];
  for (let n = 1; n <= CHEM_EXAM_TICKET_TOTAL; n++) {
    if (!officialByNumber.has(n)) missing.push(n);
  }

  const shuffledQ = seededShuffle(qPool, 'chem:fill:questions');
  const shuffledT = seededShuffle(tPool, 'chem:fill:tasks');

  const result: ExamTicket[] = [];
  for (let n = 1; n <= CHEM_EXAM_TICKET_TOTAL; n++) {
    const fixed = officialByNumber.get(n);
    if (fixed) {
      result.push({ ...fixed, isRandom: false });
      continue;
    }

    const fillIdx = missing.indexOf(n);
    const qStart = fillIdx * CHEM_QUESTIONS_PER_TICKET;
    const ticketQuestions = shuffledQ.slice(qStart, qStart + CHEM_QUESTIONS_PER_TICKET);
    const task = shuffledT.length > 0 ? shuffledT[fillIdx % shuffledT.length] : null;

    if (ticketQuestions.length < CHEM_QUESTIONS_PER_TICKET || !task) continue;

    result.push({
      id: n,
      ticketNumber: String(n),
      isRandom: true,
      questions: ticketQuestions.map((q, j) => ({
        ...q,
        id: q.id ?? `r${n}_q${j + 1}`,
      })),
      task: { ...task, id: task.id ?? `r${n}_task` },
    });
  }

  return result;
}

/** Билеты для предмета: официальные (ortho, pharma, micro, chem) или случайные из вопросов/задач. */
export function buildExamTicketsForSubject(
  subjectId: string,
  questions: unknown[],
  tasks: unknown[],
): ExamTicket[] {
  if (subjectId === 'ortho') {
    return orthoTicketsData as ExamTicket[];
  }
  if (subjectId === 'pharma') {
    return buildPharmaExamTickets(questions, tasks);
  }
  if (subjectId === 'micro') {
    return buildMicroExamTickets(questions, tasks);
  }
  if (subjectId === 'chem') {
    return buildChemExamTickets(questions, tasks);
  }
  return buildRandomExamTickets(subjectId, questions, tasks);
}

export function hasExamTicketData(
  subjectId: string,
  questions: unknown[],
  tasks: unknown[],
): boolean {
  if (subjectId === 'ortho') return (orthoTicketsData as ExamTicket[]).length > 0;
  if (subjectId === 'pharma') {
    const official = pharmaTicketsData as ExamTicket[];
    if (!official.length) return false;
    const { qIds, tIds } = collectOfficialUsedIds(official);
    const qPool = normalizePool(questions).filter(q => !qIds.has(String(q.id)));
    const tPool = normalizePool(tasks).filter(t => !tIds.has(String(t.id)));
    const missing = PHARMA_EXAM_TICKET_TOTAL - official.length;
    return (
      qPool.length >= missing * PHARMA_QUESTIONS_PER_TICKET &&
      tPool.length >= 1
    );
  }
  if (subjectId === 'micro') {
    const official = microTicketsData as ExamTicket[];
    if (!official.length) return false;
    const { qIds, tIds } = collectOfficialUsedIds(official);
    const qPool = normalizePool(questions).filter(q => !qIds.has(String(q.id)));
    const tPool = normalizePool(tasks).filter(t => !tIds.has(String(t.id)));
    const missing = MICRO_EXAM_TICKET_TOTAL - official.length;
    return (
      qPool.length >= missing * MICRO_QUESTIONS_PER_TICKET &&
      tPool.length >= 1
    );
  }
  if (subjectId === 'chem') {
    const official = chemTicketsData as ExamTicket[];
    if (!official.length) return false;
    const { qIds, tIds } = collectOfficialUsedIds(official);
    const qPool = normalizePool(questions).filter(q => !qIds.has(String(q.id)));
    const tPool = normalizePool(tasks).filter(t => !tIds.has(String(t.id)));
    const missing = CHEM_EXAM_TICKET_TOTAL - official.length;
    return (
      qPool.length >= missing * CHEM_QUESTIONS_PER_TICKET &&
      tPool.length >= 1
    );
  }
  const qPool = normalizePool(questions);
  const tPool = normalizePool(tasks);
  const qPerTicket = getQuestionsPerTicket(qPool.length);
  return qPool.length >= qPerTicket && tPool.length >= 1;
}
