import { describe, expect, it } from 'vitest';
import { adminGrantDirectAccess } from '@/lib/preview';
import { getAllUserIds, ALL_USER_IDS_KEY } from '@/lib/userIndex';
import type { AppRedis } from '@/lib/redis';

/** Студент на витрине: предмет ещё не выбрал. */
function selectingUser() {
  return {
    previewStatus: 'selecting',
    activatedKey: 'promo:3950',
    facultyId: 'stomatology',
    studyGroup: '108с',
    subjects: {},
  };
}

describe('«Открыть доступ» без пробника', () => {
  it('без выбора студента и без плана админа — выдавать нечего', () => {
    expect(adminGrantDirectAccess(selectingUser())).toBeNull();
  });

  it('план админа открывает выбранные разделы и снимает пробник', () => {
    const user = adminGrantDirectAccess(selectingUser(), [{ id: 'micro', modules: ['questions', 'tests'] }]);
    expect(user).not.toBeNull();
    expect(user.subjects.micro).toBe(true);
    expect(user.paid).toBe(true);
    expect(user.previewStatus).toBeUndefined();
    expect(user.studyGroup).toBe('108с');
    expect(user.navHidden.micro).not.toContain('questions');
    expect(user.navHidden.micro).not.toContain('tests');
    expect(user.navHidden.micro).toContain('tasks');
  });

  it('пустой список разделов в плане пропускается', () => {
    expect(adminGrantDirectAccess(selectingUser(), [{ id: 'micro', modules: [] }])).toBeNull();
  });

  it('без плана берётся заявка студента', () => {
    const user = adminGrantDirectAccess({
      ...selectingUser(),
      previewStatus: 'expired',
      previewChosenSubject: 'micro',
      previewChosenModules: ['tests'],
    });
    expect(user.subjects.micro).toBe(true);
    expect(user.navHidden.micro).not.toContain('tests');
    expect(user.navHidden.micro).toContain('questions');
  });
});

/** Минимальный Redis с множествами и SCAN — для индекса пользователей. */
function setRedis(keys: string[], index: string[]) {
  const store = new Set(keys);
  const set = new Set(index);
  return {
    set,
    async smembers() { return [...set]; },
    async sadd(_k: string, ...m: string[]) { m.forEach(x => set.add(x)); return m.length; },
    async srem(_k: string, ...m: string[]) { m.forEach(x => set.delete(x)); return m.length; },
    async scan(_c: number, o: { match: string }) {
      const prefix = o.match.replace('*', '');
      return [0, [...store].filter(k => k.startsWith(prefix))] as [number, string[]];
    },
  } as unknown as AppRedis & { set: Set<string> };
}

describe('индекс пользователей админки', () => {
  it('сверяется с ключами user_id:* — пропавшие добавляет, удалённые убирает', async () => {
    const redis = setRedis(['user_id:1', 'user_id:2', 'opens:1:2026-10-15'], ['1', 'ghost']);
    const ids = await getAllUserIds(redis);
    expect(ids.sort()).toEqual(['1', '2']);
    expect([...redis.set].sort()).toEqual(['1', '2']);
    expect(ALL_USER_IDS_KEY).toBe('all_user_ids');
  });
});
