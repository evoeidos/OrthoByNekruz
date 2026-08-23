import type { AppRedis } from '@/lib/redis';
import { getAllUserIds } from '@/lib/userIndex';
import { resolveUserFacultyPromo } from '@/lib/facultyCodes';

export const FACULTY_STATS_CACHE_KEY = 'stats:faculty_students';
/** 30 суток */
export const FACULTY_STATS_TTL_SEC = 30 * 24 * 60 * 60;

export type FacultyStudentStats = {
  computedAt:    string;
  nextRefreshAt: string;
  total:         number;
  stomatology:   number;
  pediatrics:    number;
  therapeutic:   number;
  unknown:       number;
};

function emptyStats(): FacultyStudentStats {
  const now = Date.now();
  return {
    computedAt:    new Date(now).toISOString(),
    nextRefreshAt: new Date(now + FACULTY_STATS_TTL_SEC * 1000).toISOString(),
    total:         0,
    stomatology:   0,
    pediatrics:    0,
    therapeutic:   0,
    unknown:       0,
  };
}

export async function computeFacultyStudentStats(redis: AppRedis): Promise<FacultyStudentStats> {
  const ids = await getAllUserIds(redis);
  const stats = emptyStats();
  stats.total = ids.length;

  for (const id of ids) {
    try {
      let user: unknown = await redis.get(`user_id:${id}`);
      if (typeof user === 'string') {
        try { user = JSON.parse(user); } catch { user = null; }
      }
      const promo = resolveUserFacultyPromo(user as { facultyId?: string | null });
      if (!promo) {
        stats.unknown += 1;
      } else if (promo.id === 'stomatology') {
        stats.stomatology += 1;
      } else if (promo.id === 'pediatrics') {
        stats.pediatrics += 1;
      } else if (promo.id === 'therapeutic') {
        stats.therapeutic += 1;
      } else {
        stats.unknown += 1;
      }
    } catch {
      stats.unknown += 1;
    }
  }

  return stats;
}

export async function getFacultyStudentStats(
  redis: AppRedis,
  options?: { force?: boolean },
): Promise<FacultyStudentStats> {
  if (!options?.force) {
    const cached = await redis.get(FACULTY_STATS_CACHE_KEY);
    if (cached) {
      if (typeof cached === 'string') {
        try { return JSON.parse(cached) as FacultyStudentStats; } catch { /* recompute */ }
      }
      if (typeof cached === 'object') return cached as FacultyStudentStats;
    }
  }

  const stats = await computeFacultyStudentStats(redis);
  await redis.set(FACULTY_STATS_CACHE_KEY, stats, { ex: FACULTY_STATS_TTL_SEC });
  return stats;
}
