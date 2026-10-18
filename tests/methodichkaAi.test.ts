import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRedis, sleep } from './fakeRedis';

// Конспект методички делается один раз на методичку и факультет и дальше
// отдаётся всем студентам этого факультета без новой генерации.

const redis = createFakeRedis();
const users: Record<string, Record<string, unknown>> = {
  '100001': { facultyId: 'stomatology' },
  '100002': { facultyId: 'stomatology' },
  '100003': { facultyId: 'pediatrics' },
  '100004': { studyGroup: '208с' },
};
let methodichkaText = 'Тема 1. Кариес';
const generate = vi.fn();

vi.mock('@/lib/redis', () => ({ createRedisFromEnv: () => redis }));
vi.mock('@/lib/apiUserAuth', () => ({
  verifyApiStudyUser: async (_initData: unknown, telegramId: unknown) => ({
    ok: true, tgId: String(telegramId), user: users[String(telegramId)],
  }),
}));
vi.mock('@/lib/universityParser', () => ({
  fetchUniversityMethodichka: async () => ({
    login: 'x',
    methodichka: { title: 'Методичка', chapters: [{ title: 'Глава', paragraphs: [methodichkaText] }] },
  }),
}));
vi.mock('@/lib/aiRateLimit', () => ({ checkAiRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/alertAdmin', () => ({ alertAdmin: () => {} }));
vi.mock('@/lib/questionAi', () => ({
  friendlyAiError: (s: string) => s,
  generateQuestionAiAnswer: (system: string, prompt: string) => generate(system, prompt),
}));

const { POST } = await import('@/app/api/ai/methodichka/route');

async function ask(telegramId: string, extra: Record<string, string> = {}) {
  const res = await POST(new Request('http://x/api/ai/methodichka', {
    method: 'POST',
    body: JSON.stringify({ tlId: '555', telegramId, initData: 'x', ...extra }),
  }));
  return { status: res.status, body: await res.json() as { result?: string; error?: string } };
}

beforeEach(() => {
  redis.store.clear();
  methodichkaText = 'Тема 1. Кариес';
  generate.mockReset();
  generate.mockImplementation(async (_s: string, prompt: string) => {
    await sleep(30);
    return { result: `конспект: ${prompt.split('\n')[0]}` };
  });
});

describe('конспект методички от ИИ', () => {
  it('второй студент того же факультета получает сохранённый конспект', async () => {
    const first = await ask('100001', { topic: 'Кариес', discipline: 'Терапевтическая стоматология' });
    // Другая вкладка называет тему иначе — конспект тот же.
    const second = await ask('100002', { topic: 'Тема 1', discipline: 'Стоматология' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.body.result).toBe(first.body.result);
    expect(first.body.result).toContain('Стоматологический факультет');
  });

  it('у другого факультета свой конспект', async () => {
    await ask('100001');
    const ped = await ask('100003');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(ped.body.result).toContain('Педиатрический факультет');
  });

  it('факультет без выбора — по букве группы', async () => {
    await ask('100001');
    await ask('100004');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('одновременные первые нажатия ждут одну генерацию', async () => {
    const [a, b] = await Promise.all([ask('100001'), ask('100002')]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(a.body.result).toBeTruthy();
    expect(b.body.result).toBe(a.body.result);
    expect(redis.store.has('ai:methodichka:gen:stomatology:555')).toBe(false);
  });

  it('изменённая методичка — конспект пересоздаётся', async () => {
    await ask('100001');
    methodichkaText = 'Тема 1. Кариес (новая редакция)';
    await ask('100002');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('обрезанный конспект сохраняется на неделю и не генерируется заново', async () => {
    generate.mockResolvedValueOnce({ result: 'длинный конспект без конца', truncated: true });
    await ask('100001');
    const again = await ask('100001');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(again.body.result).toBe('длинный конспект без конца');
    const saved = redis.store.get('ai:methodichka:v3:stomatology:555') as { truncated?: boolean };
    expect(saved.truncated).toBe(true);
  });

  it('неудача ИИ не сохраняется и снимает блокировку', async () => {
    generate.mockResolvedValueOnce({ error: 'пусто' });
    const failed = await ask('100001');
    expect(failed.status).toBe(503);
    expect(redis.store.has('ai:methodichka:gen:stomatology:555')).toBe(false);
    const retry = await ask('100002');
    expect(retry.body.result).toBeTruthy();
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
