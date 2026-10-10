'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthCampusBackdrop, AuthHeroPitch, AuthHeroTitle, FacultyAmbience } from '@/components/AuthFacultyExperience';
import { applyWebAccountLocal, webAuth } from '@/lib/webAuthClient';

/**
 * Вход на сайт вне Telegram — только через Telegram (OIDC): после входа
 * /api/auth/telegram-oidc/callback ставит cookie-сессию и возвращает на «/»,
 * где AuthGate уже видит сессию. Вход по email/паролю убран.
 */
export function WebAuthScreen() {
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
          <p className="text-center text-[13px] text-white/70">Вход на сайт</p>
          <a
            href="/api/auth/telegram-oidc/start"
            className="w-full h-[52px] rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))',
              color: '#0A0E0C',
            }}
          >
            Войти через Telegram
          </a>
          <p className="text-center text-[12px] text-white/40">
            Или открой приложение в Telegram через бота.
          </p>
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
