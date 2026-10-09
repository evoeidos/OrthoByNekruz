"use client";

import React, { useState } from 'react';
import { FacultyIcon } from '@/components/FacultyIcon';
import { Loader2 } from 'lucide-react';
import { STUDY_GROUP_DIGITS_PLACEHOLDER } from '@/lib/studyGroup';

interface PreviewGroupScreenProps {
  loading?: boolean;
  onSubmit: (groupDigits: string) => void;
  /** Контекст показа — подпись под заголовком */
  context?: 'payment' | 'default';
}

export const PreviewGroupScreen: React.FC<PreviewGroupScreenProps> = ({
  loading = false,
  onSubmit,
  context = 'default',
}) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const d = value.replace(/\D/g, '');
    if (!d) {
      setError('Укажи номер группы');
      return;
    }
    if (d.length < 2 || d.length > 4) {
      setError('От 2 до 4 цифр, например 108');
      return;
    }
    setError('');
    onSubmit(d);
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-6"
      style={{ background: 'var(--c-bg)' }}
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div
            className="w-[72px] h-[72px] rounded-[24px] flex items-center justify-center mb-4"
            style={{
              background: 'var(--c-primary-dim)',
              border: '1.5px solid var(--c-primary-br)',
            }}
          >
            <FacultyIcon size={40} />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight mb-2" style={{ color: 'var(--c-text)' }}>
            Твоя группа
          </h1>
          <p className="text-sm leading-relaxed max-w-xs" style={{ color: 'var(--c-muted)' }}>
            {context === 'payment'
              ? 'Нужна для чека после оплаты — только цифры номера группы'
              : 'Только цифры — номер группы'}
          </p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={e => {
            setValue(e.target.value.replace(/\D/g, '').slice(0, 4));
            setError('');
          }}
          placeholder={STUDY_GROUP_DIGITS_PLACEHOLDER}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={loading}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          className="w-full h-14 rounded-2xl text-center text-lg font-medium outline-none placeholder:opacity-40"
          style={{
            background: 'var(--c-card)',
            border: `1px solid ${error ? 'rgba(220,38,38,0.5)' : 'var(--c-border)'}`,
            color: 'var(--c-text)',
          }}
        />
        <p className="text-[11px] text-center -mt-3" style={{ color: 'var(--c-muted)', opacity: 0.65 }}>
          Например: 108, 207 или 114
        </p>

        {error && (
          <p className="text-sm text-center" style={{ color: '#f87171' }}>{error}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={loading || value.replace(/\D/g, '').length < 2}
          className="w-full h-[52px] rounded-2xl text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97] transition-transform duration-150"
          style={{
            background: 'var(--c-primary)',
            color: 'var(--c-bg)',
          }}
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Сохраняем...</>
            : 'Продолжить'}
        </button>
      </div>
    </div>
  );
};
