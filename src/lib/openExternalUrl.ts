/** Открыть ссылку в Telegram или в новой вкладке. */
export function openExternalUrl(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = (typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null);
  if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
