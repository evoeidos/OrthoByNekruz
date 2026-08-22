"use client";

import React, { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, Send, Sparkles } from 'lucide-react';

interface QuestionAiPanelProps {
  question: string;
  answer: string;
  accentColor?: string;
}

export const QuestionAiPanel: React.FC<QuestionAiPanelProps> = ({
  question,
  answer,
  accentColor = 'var(--c-primary)',
}) => {
  const [loading, setLoading] = useState(false);
  const [pendingMode, setPendingMode] = useState<'explain' | 'ask' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userQuestion, setUserQuestion] = useState('');

  const callAi = useCallback(async (mode: 'explain' | 'ask', prompt?: string) => {
    setLoading(true);
    setPendingMode(mode);
    setError(null);
    try {
      const tgId = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
        ?? localStorage.getItem('user_tg_id');
      const initData = (window as any).Telegram?.WebApp?.initData || '';
      if (!tgId) {
        setError('Нужна авторизация');
        return;
      }
      if (!initData && localStorage.getItem('auth_via') !== 'web') {
        setError('Нужна авторизация в Telegram');
        return;
      }
      const res = await fetch('/api/ai/question', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          question,
          answer,
          userQuestion: prompt,
          telegramId: String(tgId),
          initData,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Не удалось получить ответ');
        return;
      }
      setResult(data.result || '');
      if (mode === 'ask') setUserQuestion('');
    } catch {
      setError('Проблемы с соединением');
    } finally {
      setLoading(false);
      setPendingMode(null);
    }
  }, [question, answer]);

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" style={{ color: accentColor }} />
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>
          ИИ-помощник
        </span>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => callAi('explain')}
        className="w-full h-10 rounded-xl text-sm font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
        style={{
          background: 'var(--c-primary-dim)',
          border: '1px solid var(--c-primary-br)',
          color: 'var(--c-primary)',
        }}
      >
        {loading && pendingMode === 'explain' ? (
          <Loader2 className="w-4 h-4 animate-spin mx-auto" />
        ) : (
          'Объясни проще'
        )}
      </button>

      <div className="flex gap-2">
        <input
          type="text"
          value={userQuestion}
          onChange={e => setUserQuestion(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && userQuestion.trim() && !loading) {
              void callAi('ask', userQuestion.trim());
            }
          }}
          placeholder="Спроси по этой теме…"
          disabled={loading}
          className="flex-1 h-10 px-3 rounded-xl text-sm border focus:outline-none focus:ring-1"
          style={{
            background: 'var(--c-bg)',
            borderColor: 'var(--c-border)',
            color: 'var(--c-text)',
            caretColor: accentColor,
          }}
        />
        <button
          type="button"
          disabled={loading || !userQuestion.trim()}
          onClick={() => callAi('ask', userQuestion.trim())}
          className="w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40"
          style={{ background: accentColor, color: 'var(--c-bg)' }}
        >
          {loading && pendingMode === 'ask' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {error && (
        <div
          className="rounded-xl px-3 py-2.5 text-xs leading-relaxed"
          style={{ background: 'var(--c-danger-soft)', color: 'var(--c-danger)' }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="text-sm leading-relaxed prose prose-invert max-w-none break-words rounded-xl p-3"
          style={{
            background: 'color-mix(in srgb, var(--c-bg) 70%, var(--c-card))',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text)',
          }}
        >
          <ReactMarkdown>{result}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};
