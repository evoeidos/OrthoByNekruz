import Redis from 'ioredis';

type SetOpts = { ex?: number };

function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function deserialize(raw: string | null | undefined): unknown {
  if (raw == null) return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (raw !== '' && !Number.isNaN(n) && String(n) === raw) return n;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch { /* plain string */ }
  }
  return raw;
}

/** ioredis-обёртка с API, совместимым с @upstash/redis в этом проекте. */
export class NativeRedisClient {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return deserialize(raw) as T | null;
  }

  async set(key: string, value: unknown, opts?: SetOpts): Promise<'OK' | null> {
    const payload = serialize(value);
    if (opts?.ex) {
      return this.client.set(key, payload, 'EX', opts.ex);
    }
    return this.client.set(key, payload);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async sadd(key: string, ...members: (string | number)[]): Promise<number> {
    return this.client.sadd(key, ...members.map(String));
  }

  async srem(key: string, ...members: (string | number)[]): Promise<number> {
    return this.client.srem(key, ...members.map(String));
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string | number): Promise<number> {
    return this.client.sismember(key, String(member));
  }

  async scan(cursor: number, opts: { match: string; count: number }): Promise<[number, string[]]> {
    const [next, keys] = await this.client.scan(cursor, 'MATCH', opts.match, 'COUNT', opts.count);
    return [Number(next), keys];
  }

  pipeline() {
    const pipe = this.client.pipeline();
    const ops: Array<'get' | 'sismember'> = [];

    const chain = {
      get: (key: string) => {
        pipe.get(key);
        ops.push('get');
        return chain;
      },
      sismember: (key: string, member: string | number) => {
        pipe.sismember(key, String(member));
        ops.push('sismember');
        return chain;
      },
      exec: async () => {
        const rows = await pipe.exec();
        if (!rows) return [];
        return rows.map(([err, val], i) => {
          if (err) throw err;
          if (ops[i] === 'get') return deserialize(val as string | null);
          if (ops[i] === 'sismember') return val === 1;
          return val;
        });
      },
    };

    return chain;
  }
}

export function createNativeRedisFromEnv(): NativeRedisClient {
  const url = process.env.REDIS_URL?.trim();
  let client: Redis;

  if (url) {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  } else {
    const host = process.env.REDIS_HOST?.trim();
    const port = Number(process.env.REDIS_PORT || 6379);
    const username = process.env.REDIS_USERNAME?.trim() || 'default';
    const password = process.env.REDIS_PASSWORD ?? '';
    if (!host) {
      throw new Error('Redis env missing: set REDIS_URL or REDIS_HOST + REDIS_PASSWORD');
    }
    client = new Redis({
      host,
      port,
      username,
      password,
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }

  return new NativeRedisClient(client);
}

export async function pingNativeRedis(client: NativeRedisClient): Promise<boolean> {
  const raw = (client as unknown as { client: Redis }).client;
  await raw.connect();
  const pong = await raw.ping();
  return pong === 'PONG';
}
