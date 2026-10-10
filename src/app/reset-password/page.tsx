'use client';

// Вход по паролю убран — веб-вход только через Telegram. Страница осталась,
// чтобы старые ссылки из писем сброса не вели на 404.
export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0A0E0C' }}>
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold text-white">Вход по паролю отключён</h1>
        <p className="text-[13px] text-white/60">
          Теперь вход только через Telegram — пароль больше не нужен.
        </p>
        <a
          href="/"
          className="inline-flex h-12 px-5 items-center justify-center rounded-2xl font-semibold"
          style={{ background: 'hsl(var(--primary))', color: '#0A0E0C' }}
        >
          Войти через Telegram
        </a>
      </div>
    </div>
  );
}
