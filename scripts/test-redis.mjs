import 'dotenv/config';
import Redis from 'ioredis';

const host = process.env.REDIS_HOST;
const port = Number(process.env.REDIS_PORT || 6379);
const username = process.env.REDIS_USERNAME || 'default';
const password = process.env.REDIS_PASSWORD || '';

if (!host) {
  console.error('REDIS_HOST not set');
  process.exit(1);
}

const client = new Redis({ host, port, username, password, connectTimeout: 10000 });

try {
  const pong = await client.ping();
  console.log('ping:', pong);
  await client.set('__ping_test__', '1', 'EX', 10);
  const v = await client.get('__ping_test__');
  console.log('set/get:', v === '1' ? 'ok' : 'fail');
  await client.del('__ping_test__');
  await client.quit();
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e.message || e);
  process.exit(1);
}
