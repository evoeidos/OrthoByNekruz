"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Link2, Unlink, Calendar, GraduationCap, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { UniversityGradeRow, UniversityScheduleDay } from '@/lib/universityParser';

type BindPhase = 'idle' | 'loading' | 'success' | 'error';

function getTelegramAuth() {
  const telegram_id = localStorage.getItem('user_tg_id') || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initData = (window as any).Telegram?.WebApp?.initData || '';
  return { telegram_id, initData };
}

export const BindUniversityForm: React.FC = () => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<BindPhase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [bound, setBound] = useState(false);
  const [boundLogin, setBoundLogin] = useState('');
  const [checking, setChecking] = useState(true);
  const [schedule, setSchedule] = useState<UniversityScheduleDay[]>([]);
  const [grades, setGrades] = useState<UniversityGradeRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [showGrades, setShowGrades] = useState(false);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const { telegram_id, initData } = getTelegramAuth();
      const r = await fetch('/api/auth/university/data', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id, initData, action: 'status' }),
      });
      const d = await r.json();
      if (r.ok && d.bound) {
        setBound(true);
        setBoundLogin(d.login || '');
      } else {
        setBound(false);
        setBoundLogin('');
      }
    } catch {
      setBound(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadPersonalData = useCallback(async () => {
    setDataLoading(true);
    setErrorMsg('');
    try {
      const { telegram_id, initData } = getTelegramAuth();
      const r = await fetch('/api/auth/university/data', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id, initData, action: 'all' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка загрузки');
      setSchedule(d.schedule ?? []);
      setGrades(d.grades ?? []);
      if (d.login) setBoundLogin(d.login);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Не удалось загрузить данные');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (bound && !checking) void loadPersonalData();
  }, [bound, checking, loadPersonalData]);

  const handleBind = async () => {
    if (!login.trim() || !password) {
      setPhase('error');
      setErrorMsg('Введите логин и пароль');
      return;
    }
    setPhase('loading');
    setErrorMsg('');
    try {
      const { telegram_id, initData } = getTelegramAuth();
      const r = await fetch('/api/auth/university', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id, initData, login: login.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка привязки');
      setPhase('success');
      setBound(true);
      setBoundLogin(d.login || login.trim());
      setPassword('');
      setLogin('');
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : 'Неверный логин или пароль');
    }
  };

  const handleUnbind = async () => {
    if (!window.confirm('Отвязать аккаунт КрасГМУ?')) return;
    const { telegram_id, initData } = getTelegramAuth();
    await fetch('/api/auth/university/data', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id, initData, action: 'unbind' }),
    });
    setBound(false);
    setBoundLogin('');
    setSchedule([]);
    setGrades([]);
    setPhase('idle');
  };

  return (
    <div
      className="rounded-[20px] p-4 space-y-3"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-bold" style={{ color: 'var(--c-text)' }}>
            Личный кабинет КрасГМУ
          </div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
            Расписание и оценки с krasgmu.ru
          </div>
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
        >
          <Link2 className="w-5 h-5" />
        </div>
      </div>

      {checking ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--c-muted)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
        </div>
      ) : bound ? (
        <>
          <div
            className="rounded-[12px] px-3 py-2.5 text-[13px] font-semibold"
            style={{ background: 'color-mix(in srgb, var(--c-primary) 12%, transparent)', color: 'var(--c-primary-strong)' }}
          >
            ✓ Аккаунт успешно привязан · {boundLogin}
          </div>

          {dataLoading ? (
            <div className="flex items-center gap-2 text-[13px] py-2" style={{ color: 'var(--c-muted)' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Загружаем расписание...
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="text-[12px] font-medium" style={{ color: 'var(--c-danger)' }}>
                  {errorMsg}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>
                  <Calendar className="w-3.5 h-3.5" /> Расписание
                </div>
                {schedule.length === 0 ? (
                  <p className="text-[12px]" style={{ color: 'var(--c-muted)' }}>
                    Нет данных расписания (возможно, сайт изменил вёрстку).
                  </p>
                ) : (
                  schedule.map((day, di) => (
                    <div key={di} className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                      <div className="px-3 py-2 text-[12px] font-bold" style={{ background: 'var(--c-bg-subtle)', color: 'var(--c-text)' }}>
                        {day.date}
                      </div>
                      <div className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
                        {day.lessons.map((les, li) => (
                          <div key={li} className="px-3 py-2 text-[12px]">
                            <div className="font-semibold" style={{ color: 'var(--c-text)' }}>
                              {les.time && <span className="font-mono mr-2">{les.time}</span>}
                              {les.subject}
                            </div>
                            {(les.type || les.room || les.teacher) && (
                              <div className="mt-0.5" style={{ color: 'var(--c-muted)' }}>
                                {[les.type, les.room, les.teacher].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowGrades(v => !v)}
                className="w-full flex items-center justify-between rounded-[12px] px-3 py-2.5 text-[13px] font-semibold"
                style={{ background: 'var(--c-bg-subtle)', color: 'var(--c-text)' }}
              >
                <span className="inline-flex items-center gap-2">
                  <GraduationCap className="w-4 h-4" /> Оценки ({grades.length})
                </span>
                {showGrades ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showGrades && grades.length > 0 && (
                <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                  {grades.slice(0, 30).map((g, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]"
                      style={{ borderTop: i ? '1px solid var(--c-border)' : undefined }}
                    >
                      <span style={{ color: 'var(--c-text)' }}>{g.subject}</span>
                      <span className="font-bold font-mono" style={{ color: 'var(--c-primary)' }}>{g.grade}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={dataLoading}
                  onClick={() => void loadPersonalData()}
                >
                  Обновить
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleUnbind()}
                  className="text-[12px]"
                >
                  <Unlink className="w-3.5 h-3.5 mr-1" /> Отвязать
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Input
              placeholder="Логин (номер зачётки / email)"
              value={login}
              onChange={e => setLogin(e.target.value)}
              autoComplete="username"
              disabled={phase === 'loading'}
            />
            <Input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={phase === 'loading'}
            />
          </div>

          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--c-muted)' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
            </div>
          )}
          {phase === 'success' && (
            <div className="text-[13px] font-semibold" style={{ color: 'var(--c-primary)' }}>
              Аккаунт успешно привязан
            </div>
          )}
          {phase === 'error' && errorMsg && (
            <div className="text-[13px] font-medium" style={{ color: 'var(--c-danger)' }}>
              Ошибка: {errorMsg}
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={phase === 'loading'}
            onClick={() => void handleBind()}
          >
            {phase === 'loading' ? 'Привязка...' : 'Привязать аккаунт'}
          </Button>

          <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--c-text-faint)' }}>
            Пароль шифруется на сервере (AES-256-GCM) и используется только для обновления сессии.
          </p>
        </>
      )}
    </div>
  );
};
