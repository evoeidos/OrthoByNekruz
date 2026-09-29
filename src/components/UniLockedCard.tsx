"use client";

import React from 'react';
import { Loader2 } from 'lucide-react';

export const UniLockedCard: React.FC<{
  title: string;
  loading?: boolean;
  onBind: () => void;
}> = ({ title, loading = false, onBind }) => (
  <div
    className="rounded-[20px] px-5 py-7 text-center"
    style={{ background: 'var(--c-card)', border: '1px dashed var(--c-border)' }}
  >
    {loading ? (
      <div className="flex items-center justify-center gap-2 text-[13px]" style={{ color: 'var(--c-muted)' }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
      </div>
    ) : (
      <>
        <div className="text-[15px] font-bold" style={{ color: 'var(--c-text)' }}>{title}</div>
        <div className="text-[12.5px] mt-1.5 mb-4 leading-relaxed" style={{ color: 'var(--c-muted)' }}>
          Привяжите аккаунт КрасГМУ, чтобы видеть расписание и оценки.
        </div>
        <button
          type="button"
          onClick={onBind}
          className="px-[18px] py-2.5 rounded-[12px] text-[13px] font-bold active:scale-[0.97] transition-transform"
          style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
        >
          Привязать аккаунт
        </button>
      </>
    )}
  </div>
);
