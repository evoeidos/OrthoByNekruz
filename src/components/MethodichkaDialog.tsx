"use client";

import React, { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { getTelegramAuth } from '@/lib/uniHelpers';
import type { UniversityMethodichka } from '@/lib/universityParser';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type MethodichkaState = 'loading' | UniversityMethodichka | { error: string };

type AiState =
  | { tlId: string; status: 'loading' }
  | { tlId: string; status: 'done'; text: string }
  | { tlId: string; status: 'error'; error: string };

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={`${keyPrefix}-${i}`}>{part}</strong> : <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>,
  );
}

function AiMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (key: number) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="list-disc pl-5 space-y-1 text-[13px] leading-relaxed" style={{ color: 'var(--c-text)' }}>
        {bullets.map((b, i) => <li key={i}>{renderInline(b, `b${key}-${i}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };

  text.split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (line.startsWith('- ') || line.startsWith('* ')) {
      bullets.push(line.slice(2));
      return;
    }
    flushBullets(idx);
    if (line.startsWith('## ')) {
      blocks.push(
        <div key={`h-${idx}`} className="text-[11px] font-bold uppercase tracking-widest pt-2" style={{ color: 'var(--c-primary)' }}>
          {line.slice(3)}
        </div>,
      );
    } else if (line) {
      blocks.push(
        <p key={`p-${idx}`} className="text-[13px] leading-relaxed" style={{ color: 'var(--c-text)' }}>
          {renderInline(line, `p${idx}`)}
        </p>,
      );
    }
  });
  flushBullets(text.length);

  return <div className="space-y-2">{blocks}</div>;
}

export const MethodichkaDialog: React.FC<{
  tlId: string | null;
  state: MethodichkaState | undefined;
  /** Дисциплина и название темы — передаются ИИ, чтобы ответ не ограничивался только текстом методички. */
  context: { discipline: string; topic: string } | null;
  onClose: () => void;
}> = ({ tlId, state, context, onClose }) => {
  const [ai, setAi] = useState<AiState | null>(null);
  const aiForCurrent = ai && tlId && ai.tlId === tlId ? ai : null;
  const isReady = !!tlId && typeof state === 'object' && !('error' in state);

  const askAi = () => {
    if (!tlId) return;
    setAi({ tlId, status: 'loading' });
    (async () => {
      try {
        const { telegram_id, initData } = getTelegramAuth();
        const r = await fetch('/api/ai/methodichka', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tlId, initData, telegramId: telegram_id,
            discipline: context?.discipline, topic: context?.topic,
          }),
        });
        const d = await r.json();
        if (!r.ok || !d.result) {
          setAi({ tlId, status: 'error', error: d.error || 'Не удалось получить ответ' });
        } else {
          setAi({ tlId, status: 'done', text: d.result });
        }
      } catch (e) {
        setAi({ tlId, status: 'error', error: e instanceof Error ? e.message : 'Сетевая ошибка' });
      }
    })();
  };

  const buttonStyle = { background: 'var(--c-bg-subtle)', color: 'var(--c-text)', border: '1px solid var(--c-border)' };

  return (
    <Dialog open={!!tlId} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        hideCloseButton
        className="max-w-lg w-[92vw] max-h-[85vh] overflow-y-auto rounded-3xl p-5"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
      >
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={askAi}
            disabled={!isReady || aiForCurrent?.status === 'loading'}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
          >
            {aiForCurrent?.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            ИИ-конспект
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-bold active:scale-95 transition-transform"
            style={buttonStyle}
          >
            <X className="w-3.5 h-3.5" />
            Закрыть
          </button>
        </div>

        {(() => {
          if (state === undefined || state === 'loading') {
            return (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px]" style={{ color: 'var(--c-muted)' }}>
                <Loader2 className="w-4 h-4 animate-spin" /> Загрузка методички...
              </div>
            );
          }
          if ('error' in state) {
            return (
              <p className="text-[13px] text-center py-10 px-4" style={{ color: 'var(--c-muted)' }}>
                {state.error}
              </p>
            );
          }
          return (
            <>
              <DialogHeader>
                <DialogTitle className="text-[15px] font-bold leading-snug pr-4" style={{ color: 'var(--c-text)' }}>
                  {state.title}
                </DialogTitle>
              </DialogHeader>

              {aiForCurrent?.status === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-6 text-[13px] rounded-2xl" style={{ color: 'var(--c-muted)', background: 'var(--c-bg-subtle)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> ИИ готовит конспект...
                </div>
              )}
              {aiForCurrent?.status === 'error' && (
                <p className="text-[12.5px] px-3 py-2 rounded-2xl" style={{ color: 'var(--c-danger)', background: 'var(--c-bg-subtle)' }}>
                  {aiForCurrent.error}
                </p>
              )}
              {aiForCurrent?.status === 'done' && (
                <div className="rounded-2xl p-4" style={{ background: 'var(--c-bg-subtle)', border: '1px solid var(--c-border)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--c-primary)' }}>Конспект ИИ</div>
                  <AiMarkdown text={aiForCurrent.text} />
                </div>
              )}

              <div className="space-y-4 mt-1">
                {state.chapters.map((ch, ci) => (
                  <div key={ci}>
                    {ch.title && (
                      <div className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-primary)' }}>
                        {ch.title}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {ch.paragraphs.map((p, pi) => (
                        <p key={pi} className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--c-text)' }}>
                          {p}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
};
