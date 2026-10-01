import type { NextApiRequest, NextApiResponse } from 'next';
import { randomBytes } from 'crypto';
import { createRedisFromEnv } from '@/lib/redis';
import {
  clearSessionCookie,
  readSessionFromReq,
  setSessionCookie,
} from '@/lib/sessionCookie';
import {
  createAccount,
  getAccountByEmail,
  getAccountById,
  hashPassword,
  hashResetToken,
  isValidEmail,
  linkTelegramToAccount,
  normalizeEmail,
  rotateSession,
  saveAccount,
  toPublicAccount,
  verifyPassword,
  type WebAccount,
} from '@/lib/webAccount';
import { verifyTelegramLoginWidget, type TelegramLoginUser } from '@/lib/telegramLoginWidget';
import { getChannelUsername, isChannelSubscribed } from '@/lib/channelSubscription';
import { sendAppEmail } from '@/lib/sendAppEmail';
import { isRedisUnavailableError } from '@/lib/redisDegraded';

const redis = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const APP_URL = (process.env.APP_URL || 'https://nekruz2000n-eng-orthobynekruz-a9a4.twc1.net').replace(/\/$/, '');

function publicOk(account: WebAccount, extra: Record<string, unknown> = {}) {
  return {
    success: true,
    account: toPublicAccount(account),
    ...extra,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const mode = String(req.body?.mode || '').trim();

  try {
    if (mode === 'register') {
      const email = normalizeEmail(String(req.body?.email || ''));
      const password = String(req.body?.password || '');
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Введи корректный email.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Пароль не короче 8 символов.' });
      }
      let account: WebAccount;
      try {
        account = await createAccount(redis, email, password);
      } catch (e) {
        if (String(e).includes('EMAIL_TAKEN') || (e as Error).message === 'EMAIL_TAKEN') {
          return res.status(409).json({ error: 'Этот email уже зарегистрирован.' });
        }
        throw e;
      }
      setSessionCookie(res, account.id, account.sessionId);
      return res.status(200).json(publicOk(account));
    }

    if (mode === 'login') {
      const email = normalizeEmail(String(req.body?.email || ''));
      const password = String(req.body?.password || '');
      const account = await getAccountByEmail(redis, email);
      if (
        !account
        || !account.passwordHash
        || !account.passwordSalt
        || !verifyPassword(password, account.passwordSalt, account.passwordHash)
      ) {
        return res.status(401).json({ error: 'Неверный email или пароль.' });
      }
      // Антишаринг: новый sessionId выкидывает другие устройства
      const rotated = await rotateSession(redis, account);
      setSessionCookie(res, rotated.id, rotated.sessionId);

      let subscribed: boolean | null = null;
      if (rotated.telegramId) {
        subscribed = await isChannelSubscribed(Number(rotated.telegramId));
      }
      return res.status(200).json(publicOk(rotated, {
        needSubscription: subscribed === false,
        channel: getChannelUsername(),
      }));
    }

    if (mode === 'logout') {
      const session = readSessionFromReq(req);
      if (session) {
        const account = await getAccountById(redis, session.aid);
        if (account && account.sessionId === session.sid) {
          await rotateSession(redis, account);
        }
      }
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    if (mode === 'me') {
      const session = readSessionFromReq(req);
      if (!session) {
        return res.status(401).json({ error: 'Нет сессии', authenticated: false });
      }
      const account = await getAccountById(redis, session.aid);
      if (!account || account.sessionId !== session.sid) {
        clearSessionCookie(res);
        return res.status(401).json({
          error: 'Сессия устарела (вход с другого устройства).',
          code: 'session_replaced',
          authenticated: false,
        });
      }
      let subscribed: boolean | null = null;
      if (account.telegramId) {
        subscribed = await isChannelSubscribed(Number(account.telegramId));
      }
      return res.status(200).json({
        authenticated: true,
        account: toPublicAccount(account),
        needSubscription: subscribed === false,
        channel: getChannelUsername(),
        botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
          || process.env.TELEGRAM_BOT_USERNAME
          || '',
      });
    }

    if (mode === 'forgot') {
      const email = normalizeEmail(String(req.body?.email || ''));
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Введи корректный email.' });
      }
      const account = await getAccountByEmail(redis, email);
      // Не раскрываем, есть ли email
      if (account) {
        const token = randomBytes(32).toString('base64url');
        const tokenHash = hashResetToken(token);
        if (account.resetTokenHash) {
          await redis.del(`reset_token:${account.resetTokenHash}`);
        }
        const updated: WebAccount = {
          ...account,
          resetTokenHash: tokenHash,
          resetExpiresAt: Date.now() + 60 * 60 * 1000,
        };
        await saveAccount(redis, updated);
        await redis.set(`reset_token:${tokenHash}`, account.id, { ex: 60 * 60 });
        const link = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
        await sendAppEmail({
          to: email,
          subject: 'Сброс пароля — ByNekruz',
          text: `Ссылка для сброса пароля (1 час):\n${link}\n\nЕсли это не ты — просто игнорируй письмо.`,
          html: `<p>Ссылка для сброса пароля (действует 1 час):</p><p><a href="${link}">${link}</a></p><p>Если это не ты — просто игнорируй письмо.</p>`,
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Если email есть в системе, отправили ссылку для сброса.',
      });
    }

    if (mode === 'reset') {
      const token = String(req.body?.token || '').trim();
      const password = String(req.body?.password || '');
      if (!token || password.length < 8) {
        return res.status(400).json({ error: 'Нужен токен и пароль от 8 символов.' });
      }
      const tokenHash = hashResetToken(token);
      // Сканировать все аккаунты дорого — храним индекс reset:{hash} → accountId
      const accountId = await redis.get<string>(`reset_token:${tokenHash}`);
      let account: WebAccount | null = null;
      if (accountId) {
        account = await getAccountById(redis, String(accountId));
      }
      // fallback: если индекс ещё не писали в forgot — ищем по hash на аккаунте через email lookup невозможен
      // Пишем индекс в forgot ниже — исправим forgot to also set index
      if (!account || account.resetTokenHash !== tokenHash) {
        return res.status(400).json({ error: 'Ссылка недействительна или устарела.' });
      }
      if (!account.resetExpiresAt || Date.now() > account.resetExpiresAt) {
        return res.status(400).json({ error: 'Ссылка истекла. Запроси сброс снова.' });
      }
      const { salt, hash } = hashPassword(password);
      const rotated = await rotateSession(redis, {
        ...account,
        passwordSalt: salt,
        passwordHash: hash,
        resetTokenHash: null,
        resetExpiresAt: null,
      });
      await redis.del(`reset_token:${tokenHash}`);
      setSessionCookie(res, rotated.id, rotated.sessionId);
      return res.status(200).json(publicOk(rotated));
    }

    if (mode === 'link_telegram') {
      const session = readSessionFromReq(req);
      if (!session) {
        return res.status(401).json({ error: 'Сначала войди на сайт.' });
      }
      let account = await getAccountById(redis, session.aid);
      if (!account || account.sessionId !== session.sid) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Сессия устарела.', code: 'session_replaced' });
      }
      if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'BOT_TOKEN не настроен.' });
      }
      const tgUser = req.body?.telegram as TelegramLoginUser;
      if (!verifyTelegramLoginWidget(tgUser, BOT_TOKEN)) {
        return res.status(401).json({ error: 'Неверные данные Telegram Login.' });
      }
      try {
        account = await linkTelegramToAccount(redis, account, String(tgUser.id));
      } catch (e) {
        if ((e as Error).message === 'TG_TAKEN') {
          return res.status(409).json({
            error: 'Этот Telegram уже привязан к другому email.',
          });
        }
        throw e;
      }
      const subscribed = await isChannelSubscribed(Number(tgUser.id));
      return res.status(200).json(publicOk(account, {
        needSubscription: !subscribed,
        channel: getChannelUsername(),
        telegram: {
          id: tgUser.id,
          username: tgUser.username || null,
          firstName: tgUser.first_name || null,
        },
      }));
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (e) {
    console.error('[web-auth]', e);
    if (isRedisUnavailableError(e)) {
      return res.status(503).json({
        error: 'База данных временно перегружена (лимит Upstash). Попробуй через пару минут.',
      });
    }
    const msg = String(e instanceof Error ? e.message : e);
    if (msg.includes('Redis env missing')) {
      return res.status(503).json({
        error: 'Сервер без Redis: задай KV_REST_API_URL/TOKEN или UPSTASH_REDIS_REST_URL/TOKEN.',
      });
    }
    return res.status(500).json({ error: 'Ошибка сервера.' });
  }
}
