'use client';

import { useCallback, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { webAuth } from '@/lib/webAuthClient';

function ResetForm() {
  const params = useSearchParams();
  const token = params?.get('token') || '';
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    if (loading) return;
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { res, data } = await webAuth('reset', { token, password });
      if (!res.ok) {
        setError(data.error || 'Не удалось сменить пароль');
        return;
      }
      setDone(true);
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
    }
  }, [token, password, password2, loading]);

  if (!token) {
    return <p className="text-white/70 text-center">Нет токена сброса в ссылке.</p>;
  }

  return (
    <div className="w-full max-w-sm space-y-4">
      <h1 className="text-xl font-semibold text-white text-center">Новый пароль</h1>
      {done ? (
        <p className="text-emerald-300 text-center text-sm">Пароль обновлён. Переходим…</p>
      ) : (
        <>
          <input
            type="password"
            placeholder="Новый пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 rounded-2xl px-4 bg-white/[0.05] border border-white/10 text-white"
          />
          <input
            type="password"
            placeholder="Ещё раз"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="w-full h-12 rounded-2xl px-4 bg-white/[0.05] border border-white/10 text-white"
          />
          <button
            type="button"
            disabled={loading || password.length < 8}
            onClick={() => void submit()}
            className="w-full h-12 rounded-2xl font-semibold disabled:opacity-40"
            style={{ background: 'hsl(var(--primary))', color: '#0A0E0C' }}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Сохранить'}
          </button>
          {error && <p className="text-red-300 text-sm text-center">{error}</p>}
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0A0E0C' }}>
      <Suspense fallback={<Loader2 className="w-6 h-6 animate-spin text-white/50" />}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
