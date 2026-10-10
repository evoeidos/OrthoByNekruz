/**
 * Подписи состава билета — без данных билетов, поэтому безопасно для клиента.
 * Сами билеты (с ответами) собираются только на сервере: src/lib/examTickets.ts
 * отдаётся через /api/subject-data (type: 'tickets').
 */

/** Больше 60 вопросов — в билете 3 вопроса + задача, иначе 2 + задача. */
export const EXAM_QUESTIONS_PER_TICKET_THRESHOLD = 60;

export function getQuestionsPerTicket(questionCount: number): number {
  return questionCount > EXAM_QUESTIONS_PER_TICKET_THRESHOLD ? 3 : 2;
}

export function getExamTicketCompositionLabel(questionCount: number): string {
  const q = getQuestionsPerTicket(questionCount);
  return `${q} вопроса + задача`;
}
