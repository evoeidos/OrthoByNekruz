'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthCampusBackdrop, AuthHeroPitch, AuthHeroTitle, FacultyAmbience } from '@/components/AuthFacultyExperience';
import { applyWebAccountLocal, webAuth } from '@/lib/webAuthClient';

type Props = {
  onReady: (state: {
    telegramId: string | null;
    needTelegramLink: boolean;
    needSubscription: boolean;
    channel: string;
  }) => void;
  initialMode?: 'login' | 'register' | 'forgot';
};

export function WebAuthScreen({ onReady, initialMode = 'login' }: Props) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'forgot') {
        const { res, data } = await webAuth('forgot', { email });
        if (!res.ok) {
          setError(data.error || 'Не удалось отправить письмо');
          return;
        }
        setMessage(data.message || 'Проверь почту — отправили ссылку.');
        return;
      }
      if (mode === 'register') {
        if (password !== password2) {
          setError('Пароли не совпадают');
          return;
        }
        const { res, data } = await webAuth('register', { email, password });
        if (!res.ok) {
          setError(data.error || 'Не удалось зарегистрироваться');
          return;
        }
        applyWebAccountLocal(data.account);
        onReady({
          telegramId: data.account?.telegramId || null,
          needTelegramLink: !data.account?.telegramId,
          needSubscription: false,
          channel: 'nzsdental',
        });
        return;
      }
      const { res, data } = await webAuth('login', { email, password });
      if (!res.ok) {
        setError(data.error || 'Неверный email или пароль');
        return;
      }
      applyWebAccountLocal(data.account);
      onReady({
        telegramId: data.account?.telegramId || null,
        needTelegramLink: !data.account?.telegramId,
        needSubscription: data.needSubscription === true,
        channel: data.channel || 'nzsdental',
      });
    } catch {
      setError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  }, [email, password, password2, mode, loading, onReady]);

  return (
    <div
      className="dark flex flex-col items-center justify-center min-h-screen p-6 relative overflow-hidden pt-16"
      style={{ background: '#0A0E0C' }}
    >
      <AuthCampusBackdrop facultyId={null} />
      <FacultyAmbience facultyId={null} />
      <div className="w-full max-w-sm flex flex-col items-center z-10">
        <div className="mb-6 flex flex-col items-center space-y-5 text-center">
          <AuthHeroTitle />
          <AuthHeroPitch />
        </div>
        <div className="w-full space-y-4 bg-[#0A0E0C]/75 p-6 rounded-[28px] border border-white/10 backdrop-blur-xl shadow-2xl">
          <p className="text-center text-[13px] text-white/70">
            {mode === 'login' && 'Вход на сайт'}
            {mode === 'register' && 'Регистрация'}
            {mode === 'forgot' && 'Восстановление пароля'}
          </p>
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-12 rounded-2xl px-4 bg-white/[0.05] border border-white/10 text-white text-[15px]"
          />
          {mode !== 'forgot' && (
            <input
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder="Пароль (от 8 символов)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-12 rounded-2xl px-4 bg-white/[0.05] border border-white/10 text-white text-[15px]"
            />
          )}
          {mode === 'register' && (
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Повтори пароль"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full h-12 rounded-2xl px-4 bg-white/[0.05] border border-white/10 text-white text-[15px]"
            />
          )}
          <button
            type="button"
            disabled={loading || !email || (mode !== 'forgot' && password.length < 8)}
            onClick={() => void submit()}
            className="w-full h-[52px] rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))',
              color: '#0A0E0C',
            }}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === 'forgot' ? 'Отправить ссылку' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
          {error && (
            <p className="text-center text-[13px] text-red-300">{error}</p>
          )}
          {message && (
            <p className="text-center text-[13px] text-emerald-300">{message}</p>
          )}
          {mode !== 'forgot' && (
            <>
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] text-white/30">или</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <a
                href="/api/auth/telegram-oidc/start"
                className="w-full h-12 rounded-2xl text-[14px] font-medium flex items-center justify-center gap-2 bg-white/[0.05] border border-white/10 text-white"
              >
                Войти через Telegram
              </a>
            </>
          )}
          <div className="flex flex-col gap-2 pt-1">
            {mode === 'login' && (
              <>
                <button type="button" className="text-[12px] text-white/40" onClick={() => setMode('register')}>
                  Нет аккаунта? Зарегистрироваться
                </button>
                <button type="button" className="text-[12px] text-white/40" onClick={() => setMode('forgot')}>
                  Забыл пароль
                </button>
              </>
            )}
            {mode !== 'login' && (
              <button type="button" className="text-[12px] text-white/40" onClick={() => setMode('login')}>
                ← Ко входу
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type LinkProps = {
  botUsername: string;
  channel: string;
  needSubscription?: boolean;
  onLinked: (state: { telegramId: string; needSubscription: boolean }) => void;
};

export function LinkTelegramScreen({ botUsername, channel, needSubscription, onLinked }: LinkProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const w = window as any;
    w.__bnOnTelegramAuth = async (user: Record<string, unknown>) => {
      setLoading(true);
      setError('');
      try {
        const { res, data } = await webAuth('link_telegram', { telegram: user });
        if (!res.ok) {
          setError(data.error || 'Не удалось привязать Telegram');
          return;
        }
        applyWebAccountLocal(data.account);
        onLinked({
          telegramId: String(data.account.telegramId),
          needSubscription: data.needSubscription === true,
        });
      } catch {
        setError('Ошибка соединения');
      } finally {
        setLoading(false);
      }
    };

    if (!hostRef.current || !botUsername) return;
    hostRef.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', '__bnOnTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    hostRef.current.appendChild(script);

    return () => {
      delete w.__bnOnTelegramAuth;
    };
  }, [botUsername, onLinked]);

  return (
    <div
      className="dark flex flex-col items-center justify-center min-h-screen p-6 relative overflow-hidden"
      style={{ background: '#0A0E0C' }}
    >
      <div className="w-full max-w-sm space-y-5 bg-[#0A0E0C]/80 p-6 rounded-[28px] border border-white/10 text-center">
        <h1 className="text-xl font-semibold text-white">Привяжи Telegram</h1>
        <p className="text-[13px] text-white/60 leading-relaxed">
          Без Telegram нельзя проверить подписку на канал @{channel}.
          Один аккаунт — один Telegram.
        </p>
        {needSubscription && (
          <a
            href={`https://t.me/${channel}`}
            target="_blank"
            rel="noreferrer"
            className="block text-[14px] font-medium text-emerald-300 underline"
          >
            Подписаться на @{channel}
          </a>
        )}
        <div ref={hostRef} className="flex justify-center min-h-[40px]" />
        {!botUsername && (
          <p className="text-[12px] text-amber-200">
            На сервере не задан TELEGRAM_BOT_USERNAME — виджет не загрузится.
          </p>
        )}
        {loading && <Loader2 className="w-5 h-5 animate-spin mx-auto text-white/70" />}
        {error && <p className="text-[13px] text-red-300">{error}</p>}
      </div>
    </div>
  );
}

export function NeedSubscriptionScreen({ channel }: { channel: string }) {
  return (
    <div
      className="dark flex flex-col items-center justify-center min-h-screen p-6"
      style={{ background: '#0A0E0C' }}
    >
      <div className="w-full max-w-sm space-y-4 bg-[#0A0E0C]/80 p-6 rounded-[28px] border border-white/10 text-center">
        <h1 className="text-xl font-semibold text-white">Нужна подписка</h1>
        <p className="text-[13px] text-white/60">
          Подпишись на канал @{channel}, затем обнови страницу.
        </p>
        <a
          href={`https://t.me/${channel}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-12 px-5 items-center justify-center rounded-2xl font-semibold text-[#0A0E0C]"
          style={{ background: 'hsl(var(--primary))' }}
        >
          Открыть @{channel}
        </a>
        <button
          type="button"
          className="block w-full text-[12px] text-white/40"
          onClick={() => window.location.reload()}
        >
          Я подписался — обновить
        </button>
      </div>
    </div>
  );
}
