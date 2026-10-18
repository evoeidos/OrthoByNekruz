// Next вызывает register() один раз при запуске сервера. Детектор замираний
// стартует здесь, а не при первом обращении к Redis: иначе холодный старт
// после деплоя (загрузка модулей первых роутов) проходил мимо учёта.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startProcessHealthMonitor } = await import('@/lib/processHealth');
  startProcessHealthMonitor();
}
