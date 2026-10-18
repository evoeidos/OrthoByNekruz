import { describe, expect, it } from 'vitest';
import type { NextApiResponse } from 'next';
import { updateUser, withUserLock, withUserLockResponse } from '@/lib/userLock';
import { createFakeRedis, sleep } from './fakeRedis';

describe('userLock', () => {
  it('не теряет подтверждение админа, пока студентский запрос пишет старую копию', async () => {
    const redis = createFakeRedis();
    redis.store.set('user_id:1', { n: 0 });

    const student = withUserLock(redis, '1', async () => {
      const user = await redis.get<Record<string, unknown>>('user_id:1');
      await sleep(80); // медленный запрос: проверка подписки в Telegram и т.п.
      await redis.set('user_id:1', { ...user, synced: true });
    });
    await sleep(10);
    const admin = updateUser<Record<string, unknown>>(redis, '1', u => ({ ...u, confirmed: true }));
    await Promise.all([student, admin]);

    expect(redis.store.get('user_id:1')).toMatchObject({ synced: true, confirmed: true });
  });

  it('20 параллельных обновлений — ни одно не потеряно', async () => {
    const redis = createFakeRedis();
    redis.store.set('user_id:2', { n: 0 });
    await Promise.all(
      Array.from({ length: 20 }, () => updateUser<{ n: number }>(redis, '2', u => ({ n: (u?.n ?? 0) + 1 }))),
    );
    expect(redis.store.get('user_id:2')).toEqual({ n: 20 });
  }, 20_000); // проверка корректности, не скорости: под нагрузкой очередь идёт медленнее

  it('вложенный вызов внутри блокировки не ждёт сам себя', async () => {
    const redis = createFakeRedis();
    redis.store.set('user_id:3', { n: 0 });
    const result = await Promise.race([
      withUserLock(redis, '3', () => updateUser(redis, '3', () => ({ n: 1 })).then(() => 'done')),
      sleep(2000).then(() => 'deadlock'),
    ]);
    expect(result).toBe('done');
    expect(redis.store.get('user_id:3')).toEqual({ n: 1 });
  });

  it('снимает блокировку и после успеха, и после ошибки', async () => {
    const redis = createFakeRedis();
    await withUserLock(redis, '4', async () => {});
    await expect(withUserLock(redis, '4', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(redis.store.has('user_lock:4')).toBe(false);
  });

  it('разные пользователи не ждут друг друга', async () => {
    // Проверяем пересечение участков, а не время: замер по часам мигал под нагрузкой.
    const redis = createFakeRedis();
    let insideA = false;
    let bRanWhileAInside = false;
    await Promise.all([
      withUserLock(redis, 'a', async () => {
        insideA = true;
        await sleep(150);
        insideA = false;
      }),
      withUserLock(redis, 'b', async () => {
        await sleep(50);
        bRanWhileAInside = insideA;
      }),
    ]);
    expect(bRanWhileAInside).toBe(true);
  });

  it('если Redis недоступен для блокировки — запрос всё равно выполняется', async () => {
    const redis = createFakeRedis({ failLockSet: true });
    await expect(withUserLock(redis, '6', async () => 'ran')).resolves.toBe('ran');
  });

  it('без изменений — без записи', async () => {
    const redis = createFakeRedis();
    redis.store.set('user_id:7', { a: 1 });
    let writes = 0;
    const set = redis.set.bind(redis);
    redis.set = (async (key: string, value: unknown, o?: { ex?: number; nx?: boolean }) => {
      if (key === 'user_id:7') writes++;
      return set(key, value, o);
    }) as typeof redis.set;
    await updateUser(redis, '7', u => u);
    expect(writes).toBe(0);
  });

  // Serverless-контейнер замораживается сразу после ответа: блокировка
  // должна быть снята до того, как ответ ушёл клиенту.
  it('ответ из-под блокировки уходит только после её снятия', async () => {
    const redis = createFakeRedis();
    const sent: Array<{ status: number; body: unknown; lockHeld: boolean }> = [];
    let statusCode = 200;
    const res = {
      status(code: number) { statusCode = code; return res; },
      json(body: unknown) {
        sent.push({ status: statusCode, body, lockHeld: redis.store.has('user_lock:9') });
        return res;
      },
    } as unknown as NextApiResponse;

    await withUserLockResponse(redis, '9', res, async r => {
      r.status(201).json({ ok: true });
      expect(sent).toHaveLength(0);
      expect(redis.store.has('user_lock:9')).toBe(true);
    });

    expect(sent).toEqual([{ status: 201, body: { ok: true }, lockHeld: false }]);
  });

  it('без ответа внутри блокировки ничего не отправляется', async () => {
    const redis = createFakeRedis();
    let calls = 0;
    const res = { status() { return this; }, json() { calls++; return this; } } as unknown as NextApiResponse;
    await withUserLockResponse(redis, '9', res, async () => {});
    expect(calls).toBe(0);
  });
});
