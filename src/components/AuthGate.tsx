'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthScreen } from '@/components/AuthScreen';
import {
  LinkTelegramScreen,
  NeedSubscriptionScreen,
  WebAuthScreen,
} from '@/components/WebAuthScreen';
import { applyWebAccountLocal, isInsideTelegramWebApp, waitForTelegramWebApp, webAuth } from '@/lib/webAuthClient';

type GatePhase =
  | 'boot'
  | 'web_login'
  | 'link_telegram'
  | 'need_subscription'
  | 'faculty'
  | 'done';

type Props = {
  onAuthenticated: () => void;
};

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';
const CHANNEL = process.env.NEXT_PUBLIC_CHANNEL_USERNAME || 'nzsdental';

export function AuthGate({ onAuthenticated }: Props) {
  const [phase, setPhase] = useState<GatePhase>('boot');
  const [channel, setChannel] = useState(CHANNEL);
  const [botUsername, setBotUsername] = useState(BOT_USERNAME);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isInsideTelegramWebApp() || (await waitForTelegramWebApp())) {
        if (!cancelled) setPhase('faculty');
        return;
      }
      try {
        const { res, data } = await webAuth('me');
        if (cancelled) return;
        if (data?.botUsername) setBotUsername(String(data.botUsername));
        if (res.ok && data.authenticated) {
          applyWebAccountLocal(data.account || {});
          setChannel(data.channel || CHANNEL);
          if (data.account?.needsTelegramLink || !data.account?.telegramId) {
            setPhase('link_telegram');
            return;
          }
          if (data.needSubscription) {
            setPhase('need_subscription');
            return;
          }
          setPhase('faculty');
          return;
        }
        if (data?.code === 'session_replaced') {
          localStorage.removeItem('is_authed');
          localStorage.removeItem('user_tg_id');
          localStorage.removeItem('auth_via');
        }
      } catch {
        /* fall through to login */
      }
      if (!cancelled) setPhase('web_login');
    })();
    return () => { cancelled = true; };
  }, []);

  const afterLinked = useCallback((state: { telegramId: string; needSubscription: boolean }) => {
    if (state.needSubscription) {
      setPhase('need_subscription');
      return;
    }
    setPhase('faculty');
  }, []);

  if (phase === 'boot') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (phase === 'web_login') {
    return <WebAuthScreen />;
  }

  if (phase === 'link_telegram') {
    return (
      <LinkTelegramScreen
        botUsername={botUsername}
        channel={channel}
        onLinked={afterLinked}
      />
    );
  }

  if (phase === 'need_subscription') {
    return <NeedSubscriptionScreen channel={channel} />;
  }

  return <AuthScreen onAuthenticated={onAuthenticated} />;
}
