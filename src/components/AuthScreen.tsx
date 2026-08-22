"use client"; // Указывает Next.js, что этот компонент должен выполняться на стороне клиента (в браузере), так как тут есть хуки состояния (useState, useEffect).

// ─── ИМПОРТЫ ─────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input'; // Компонент поля ввода (из библиотеки shadcn/ui)
import { Button } from '@/components/ui/button'; // Компонент кнопки (из библиотеки shadcn/ui)
import { useToast } from '@/hooks/use-toast'; // Хук для показа всплывающих уведомлений (тостов)
import { Loader2, ExternalLink, Heart } from 'lucide-react'; // Иконки из библиотеки lucide-react
import { cn } from '@/lib/utils';
import {
  detectFacultyByInput,
  resolveFacultyPromoCode,
  MAX_INPUT_LENGTH,
  getDefaultDigitIcon,
  isLegacyPaidKey,
  FACULTY_AUTH_THEME,
  persistFacultyId,
  persistFacultyFromAccessCode,
} from '@/lib/facultyCodes';
import { applyClientAccessCacheVersion } from '@/lib/accessCache';
import {
  AuthCampusBackdrop,
  AuthHeroPitch,
  AuthHeroTitle,
  FacultyAmbience,
  FacultyPicker,
} from '@/components/AuthFacultyExperience';

function syncFacultyAfterAuth(data: { facultyId?: string | null }, accessCode: string) {
  if (data?.facultyId) persistFacultyId(String(data.facultyId));
  else if (accessCode.trim()) persistFacultyFromAccessCode(accessCode.trim());
}

export const AuthScreen = ({ onAuthenticated }: { onAuthenticated: () => void }) => {
  const { toast } = useToast();

  // ── Стейты (Состояния компонента) ──
  const [mounted, setMounted] = useState(false);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [isPaidKeysEnabled, setIsPaidKeysEnabled] = useState(true);

  useEffect(() => {
    fetch('/api/admin-config')
      .then(res => res.json())
      .then(data => {
        if (typeof data.isPaidKeysEnabled === 'boolean') {
          setIsPaidKeysEnabled(data.isPaidKeysEnabled);
        }
      })
      .catch(err => console.error('Ошибка загрузки конфига:', err));
  }, []);

  // Время блокировки (в секундах) при неверном вводе. Берем из localStorage, если юзер обновил страницу.
  const [lockoutTime, setLockoutTime] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const until = Number(localStorage.getItem('lockout_until') || '0');
    const left  = Math.ceil((until - Date.now()) / 1000);
    return left > 0 ? left : 0;
  });

  const [needsSubscription, setNeedsSubscription] = useState(false); // Флаг: нужно ли подписаться на канал
  const [showWelcome, setShowWelcome] = useState(false); // Показывать ли приветственное окно ("Рад видеть!")
  const [manualTgId, setManualTgId] = useState(''); // Telegram ID, если юзер вводит его вручную
  const [autoTgId, setAutoTgId] = useState<string | null>(null); // Telegram ID, полученный автоматически
  const [idChecked, setIdChecked] = useState(false); // Проверили ли мы наличие Telegram ID
  const [idCheckAttempts, setIdCheckAttempts] = useState(0); // Количество попыток получить ID
  const [initData, setInitData] = useState(''); // Данные инициализации от Telegram
  const [errorMessage, setErrorMessage] = useState(''); // Текст ошибки ключа

  const maxAttempts = 20; // Макс. попыток дождаться Telegram
  const attemptInterval = 500; // Интервал между попытками (полсекунды)

  // ── Хуки жизненного цикла ──

  // Устанавливаем mounted в true после первой загрузки (защита от ошибок гидратации Next.js)
  useEffect(() => {
    applyClientAccessCacheVersion();
    setMounted(true);
  }, []);

  // Таймер блокировки. Каждую секунду отнимает 1 от lockoutTime, пока не дойдет до 0.
  useEffect(() => {
    if (lockoutTime <= 0) return;
    const iv = setInterval(() => {
      setLockoutTime(t => {
        if (t <= 1) { clearInterval(iv); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [lockoutTime]);

  // Инициализация Telegram WebApp
  useEffect(() => {
    if (!mounted) return;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready(); // Сообщаем Telegram, что приложение готово
      tg.expand?.(); // Разворачиваем на весь экран
      try { tg.setBackgroundColor('#0A0E0C'); } catch {} // Красим шапку Telegram в цвет нашего фона
      if (tg.initData) setInitData(tg.initData); // Сохраняем данные для проверки подлинности на сервере
    }
  }, [mounted]);

  // Автоматический поиск Telegram ID пользователя
  useEffect(() => {
    if (!mounted || autoTgId !== null || idCheckAttempts >= maxAttempts) {
      if (idCheckAttempts >= maxAttempts) setIdChecked(true); // Если попытки кончились, сдаемся
      return;
    }
    const timer = setTimeout(() => {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        // Обновляем initData при каждой попытке — он может появиться позже
        if (tg.initData) setInitData(tg.initData);

        // Пытаемся достать ID из разных мест
        let id = tg.initDataUnsafe?.user?.id;
        if (!id && tg.initData) {
          try { id = JSON.parse(new URLSearchParams(tg.initData).get('user') || '{}').id; } catch {}
        }
        if (id) {
          setAutoTgId(String(id)); // Успешно нашли!
          setIdChecked(true);
        }
        else {
          setIdCheckAttempts(p => p + 1);
        }
      } else {
        setIdCheckAttempts(p => p + 1);
      }
    }, attemptInterval);
    return () => clearTimeout(timer);
  }, [mounted, autoTgId, idCheckAttempts]);

  // Продолжаем искать ID в фоне после показа поля ручного ввода
  // На некоторых версиях Telegram initData появляется с задержкой > 10 секунд
  const [bgAttempts, setBgAttempts] = useState(0);
  const maxBgAttempts = 40;
  useEffect(() => {
    if (!mounted || !idChecked || autoTgId !== null || bgAttempts >= maxBgAttempts) return;
    const timer = setTimeout(() => {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        if (tg.initData) setInitData(prev => prev || tg.initData);
        let id = tg.initDataUnsafe?.user?.id;
        if (!id && tg.initData) {
          try { id = JSON.parse(new URLSearchParams(tg.initData).get('user') || '{}').id; } catch {}
        }
        if (id) setAutoTgId(String(id));
      }
      setBgAttempts(p => p + 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [mounted, idChecked, autoTgId, bgAttempts]);

  // Уже зарегистрированные клиенты — без повторного ввода ключа
  const silentLoginTried = useRef(false);
  useEffect(() => {
    if (!mounted || !autoTgId || !initData || silentLoginTried.current) return;
    silentLoginTried.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: String(autoTgId),
            mode: 'check_subjects',
            initData,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.registered !== false) {
          const hasAccess = Array.isArray(data.subjects) && data.subjects.length > 0;
          const inFlow = data.previewStatus === 'selecting'
            || data.previewStatus === 'active'
            || data.previewStatus === 'expired'
            || data.previewStatus === 'confirmed'
            || data.needsStudyGroup === true;
          if (hasAccess || inFlow) {
            localStorage.setItem('is_authed', 'true');
            localStorage.setItem('user_tg_id', String(autoTgId));
            syncFacultyAfterAuth(data, '');
            onAuthenticated();
          }
        }
      } catch { /* остаёмся на экране кода */ }
    })();
    return () => { cancelled = true; };
  }, [mounted, autoTgId, initData, onAuthenticated]);

  // ── Секретная функция сброса (6 быстрых тапов по названию) ──
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTitleClick = useCallback(() => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    
    if (tapCountRef.current >= 6) {
      localStorage.clear(); // Полностью очищаем память (сессию)
      toast({ title: 'Session reset', description: 'Storage cleared.' });
      setTimeout(() => window.location.reload(), 500); // Перезагружаем страницу
      tapCountRef.current = 0;
    } else {
      tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 2000); // Если пауза между тапами > 2 сек, счетчик обнуляется
    }
  }, [toast]);

  // ── Основная функция проверки ключа (Обращение к серверу API) ──
  const handleAuth = useCallback(async (inputKey: string, inputTgId: string) => {
    if (loading || lockoutTime > 0 || !inputTgId) return;
    setLoading(true); setError(false); setNeedsSubscription(false);
    
    try {
      // Отправляем запрос на наш бэкенд
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: inputKey.trim(), telegramId: String(inputTgId), initData }),
      });
      const data = await res.json();
      
      if (res.ok) {
        localStorage.setItem('is_authed', 'true');
        localStorage.setItem('user_tg_id', String(inputTgId));
        syncFacultyAfterAuth(data, inputKey);
        if (data.alreadyConfirmed) {
          toast({
            title: 'Доступ уже открыт',
            description: 'Код факультета сохранён — можно продолжать.',
          });
        }
        if (data.previewStatus || data.preview) {
          onAuthenticated();
          return;
        }
        if (!localStorage.getItem('welcome_seen') && inputKey !== '') {
          setShowWelcome(true);
        } else {
          onAuthenticated();
        }
      } else {
        // Ошибки сервера
        if (res.status === 403 && data.blocked) {
          setError(true);
          setErrorMessage('Твой аккаунт заблокирован. Свяжись с администратором.');
          setTimeout(() => setErrorMessage(''), 6000);
        } else if (res.status === 403 && data.noInitData) {
          setError(true);
          setErrorMessage('Открой приложение через кнопку бота в Telegram, а не через браузер.');
          setTimeout(() => setErrorMessage(''), 8000);
        } else if (res.status === 403 && data.previewAwaiting) {
          localStorage.setItem('is_authed', 'true');
          localStorage.setItem('user_tg_id', String(inputTgId));
          syncFacultyAfterAuth(data, inputKey);
          onAuthenticated();
        } else if (res.status === 403 && data.needSubscription) {
          setNeedsSubscription(true);
        } else if (res.status === 403) {
          setError(true);
          setErrorMessage(data.error || 'Доступ запрещён');
          setTimeout(() => setErrorMessage(''), 5000);
        } else if (res.status >= 500) {
          setError(true);
          setErrorMessage(data.error || 'Ошибка сервера.');
          setTimeout(() => setErrorMessage(''), 6000);
        } else {
          // Неверный ключ. Блокируем ввод на 60 секунд (Защита от подбора)
          const LOCKOUT_SEC = 60;
          localStorage.setItem('lockout_until', String(Date.now() + LOCKOUT_SEC * 1000));
          setLockoutTime(LOCKOUT_SEC);
          setError(true); // Запускает анимацию тряски
          setErrorMessage(data.error || 'Неверный ключ доступа');
          setTimeout(() => setErrorMessage(''), 4000);
        }
      }
    } catch {
      setErrorMessage('Ошибка соединения с сервером');
      setTimeout(() => setErrorMessage(''), 4000);
    } finally {
      setLoading(false);
    }
  }, [loading, lockoutTime, onAuthenticated, toast, initData]);

  // ── Обработчик клика по кнопке "Войти" ──
  const handleLoginClick = () => {
    const id = autoTgId || manualTgId.trim();
    if (!id) { toast({ variant: 'destructive', title: 'ID не найден', description: 'Введи ID вручную' }); return; }
    if (!/^\d{5,12}$/.test(id) || Number(id) < 10000) {
      toast({ variant: 'destructive', title: 'Неверный ID', description: 'Telegram ID должен быть числовым (5-12 цифр)' }); return;
    }
    if (!canEnter) {
      const msg = passwordMode
        ? (isPaidKeysEnabled ? 'Введи 8-значный пароль полностью' : 'Вход по паролю временно отключён')
        : 'Сначала выбери факультет';
      toast({ variant: 'destructive', title: 'Нельзя войти', description: msg });
      return;
    }
    handleAuth(key, id);
  };

  // Пока компонент не смонтирован (hydration), ничего не рендерим, чтобы избежать мерцаний
  if (!mounted) return null;

  const promoHint   = passwordMode || isLegacyPaidKey(key) ? null : detectFacultyByInput(key);
  const digitIcon   = promoHint?.digitIcon ?? getDefaultDigitIcon();
  const promoReady  = !passwordMode && !!resolveFacultyPromoCode(key);
  const legacyReady = passwordMode && isLegacyPaidKey(key) && isPaidKeysEnabled;
  const canEnter    = promoReady || legacyReady;
  const activeFacultyId = passwordMode ? null : (promoHint?.id ?? null);
  const loginAccent = activeFacultyId ? FACULTY_AUTH_THEME[activeFacultyId]?.accent : null;

  // ── ВИЗУАЛЬНАЯ ЧАСТЬ (RENDER) ───────────────────────────────────────────────
  return (
    // Главный контейнер. Темный, растянут на весь экран. Цвет фона - глубокий изумрудно-черный (#0A0E0C).
    <div
      className="dark flex flex-col items-center justify-center min-h-screen p-6 relative overflow-hidden pt-16"
      style={{ background: '#0A0E0C' }} 
    >
      {/* ── Окно Приветствия (Оверлей) ── */}
      {/* Показывается только один раз после успешного ввода ключа */}
      {showWelcome && (
        <div className="dark fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-xl animate-in fade-in zoom-in duration-300"
          style={{ background: 'rgba(10,14,12,0.85)' }}>
          <div className="w-full max-w-sm bg-[#121815] border border-white/10 p-8 rounded-[32px] shadow-2xl text-center space-y-6">
            <div className="inline-flex p-3 bg-primary/10 rounded-full text-primary">
              <Heart className="w-8 h-8 fill-primary/20" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-white">Рад тебя видеть!</h2>
              <p className="text-sm text-muted-foreground">Учись, исследуй, развивайся.</p>
            </div>
            <Button onClick={() => {
              localStorage.setItem('welcome_seen', 'true'); // Запоминаем, что юзер это уже видел
              setShowWelcome(false);
              onAuthenticated(); // Пускаем в приложение
            }} className="w-full h-14 rounded-2xl text-lg font-bold">Погнали!</Button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes authShake {
          0%,100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .auth-shake { animation: authShake 0.2s ease-in-out 0s 2; }
      `}</style>

      <AuthCampusBackdrop facultyId={activeFacultyId} />
      <FacultyAmbience facultyId={activeFacultyId} />

      {/* ── Контейнер с контентом авторизации ── */}
      {/* z-10 поднимает этот блок над дождем зубов */}
      <div className="w-full max-w-sm flex flex-col items-center z-10">
        
        {/* ── Блок Логотипа и Заголовка ── */}
        <div className="mb-6 flex flex-col items-center space-y-5 text-center">
          <AuthHeroTitle onTitleClick={handleTitleClick} />
          <AuthHeroPitch />
        </div>

        {/* ── Карточка с полями ввода и кнопками ── */}
        {/* Если state `error` = true, добавляем класс 'auth-shake', чтобы карточка затряслась */}
        <div className={cn('w-full space-y-4', error && 'auth-shake')}>
          
          {/* Фон карточки: глухой темно-зеленый с эффектом размытия заднего фона */}
          <div className="space-y-4 bg-[#0A0E0C]/75 p-6 rounded-[28px] border border-white/10 backdrop-blur-xl shadow-2xl">

            {!passwordMode ? (
              <>
                <FacultyPicker
                  code={key}
                  disabled={loading || lockoutTime > 0}
                  onSelect={promo => setKey(promo.code)}
                />

                <button
                  onClick={handleLoginClick}
                  disabled={loading || lockoutTime > 0 || !promoReady}
                  className="w-full h-[52px] rounded-2xl text-[15px] font-semibold transition-all duration-250 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40"
                  style={promoReady ? {
                    background: loginAccent
                      ? `linear-gradient(135deg, ${loginAccent.text}, ${loginAccent.border})`
                      : 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))',
                    color: '#0A0E0C',
                    boxShadow: loginAccent
                      ? `0 8px 24px ${loginAccent.glow}`
                      : '0 8px 24px hsl(var(--primary) / 0.3)',
                  } : {
                    background: 'hsl(var(--primary) / 0.12)',
                    color: 'hsl(var(--primary) / 0.85)',
                  }}
                >
                  {loading
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : promoReady
                      ? <>{digitIcon} Войти</>
                      : 'Войти'}
                </button>

                {isPaidKeysEnabled && (
                  <button
                    type="button"
                    onClick={() => { setPasswordMode(true); setKey(''); setError(false); }}
                    disabled={loading}
                    className="w-full text-center text-[12px] py-1 transition-opacity active:opacity-60 disabled:opacity-40"
                    style={{ color: 'rgba(255,255,255,0.38)' }}
                  >
                    Войти по паролю
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.42)' }}>
                    {lockoutTime > 0 ? `Подожди ${lockoutTime}с` : '8-значный пароль доступа'}
                  </p>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="••••••••"
                    value={key}
                    onChange={e => setKey(e.target.value.replace(/\D/g, '').slice(0, MAX_INPUT_LENGTH))}
                    disabled={loading || lockoutTime > 0}
                    className="h-14 text-center text-xl tracking-[0.35em] font-mono bg-white/[0.03] border-white/10 rounded-2xl text-white"
                  />
                </div>

                <button
                  onClick={handleLoginClick}
                  disabled={loading || lockoutTime > 0 || !legacyReady}
                  className="w-full h-[52px] rounded-2xl text-[15px] font-semibold transition-all duration-250 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40"
                  style={legacyReady ? {
                    background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))',
                    color: 'hsl(var(--primary-foreground))',
                    boxShadow: '0 8px 24px hsl(var(--primary) / 0.3)',
                  } : {
                    background: 'hsl(var(--primary) / 0.12)',
                    color: 'hsl(var(--primary) / 0.85)',
                  }}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Войти'}
                </button>

                <button
                  type="button"
                  onClick={() => { setPasswordMode(false); setKey(''); setError(false); }}
                  disabled={loading}
                  className="w-full text-center text-[12px] py-1 transition-opacity active:opacity-60"
                  style={{ color: 'rgba(255,255,255,0.38)' }}
                >
                  ← Код факультета из канала
                </button>
              </>
            )}

            {idChecked && !autoTgId && (
              <Input
                type="text" inputMode="numeric"
                placeholder="Твой Telegram ID (числовой)"
                value={manualTgId}
                onChange={e => setManualTgId(e.target.value.replace(/\D/g, '').slice(0, 12))}
                className="h-14 text-center text-lg bg-background/40 border-white/10 rounded-2xl text-white animate-in slide-in-from-top-2"
              />
            )}

            {/* ── БЛОК ОШИБКИ КЛЮЧА ── (Выезжает при неверном ключе) ── */}
            {errorMessage && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300 rounded-2xl p-4 text-center text-[14px]"
                style={{
                  background: 'rgba(220,38,38,0.15)',
                  border: '1px solid rgba(220,38,38,0.2)',
                  color: '#fca5a5',
                  animation: 'fadeInOut 4s ease forwards',
                }}>
                {errorMessage}
              </div>
            )}

            {/* ── ПРОСЬБА ПОДПИСАТЬСЯ ── */}
            {needsSubscription && (
              <p className="text-[10px] text-center text-destructive animate-pulse">
                Подпишись на{' '}
                <a
                  href="https://t.me/nzsdental"
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'underline' }}
                >
                  @nzsdental
                </a>
                {' '}и попробуй снова
              </p>
            )}
          </div>

          {/* ── ССЫЛКА НА ТЕХПОДДЕРЖКУ (DM) ── */}
          <div className="text-center mt-6">
            <a href="https://t.me/evoeidos"
              className="inline-flex items-center text-sm font-medium transition-colors"
              style={{ color: 'hsl(var(--primary) / 0.8)' }}>
              Нужен ключ? DM @evoeidos <ExternalLink className="ml-1 w-4 h-4" />
            </a>
          </div>
          
        </div>
      </div>
    </div>
  );
};