'use client';
import "./globals.css";
import React from 'react';
import { usePathname }  from 'next/navigation';
import { Toaster }    from '@/components/ui/toaster';
import Script         from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  if (isAdmin) {
    return (
      <html lang="ru">
        <body className="antialiased">{children}</body>
      </html>
    );
  }

  return (
    <html lang="ru">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-capable"          content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />

        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var theme = localStorage.getItem('theme');
            if (!theme || !['dark','light','bright'].includes(theme)) {
              // Первый запуск: берём тему из Telegram, чтобы приложение не
              // открывалось тёмным у студента со светлым клиентом.
              // Дальше выбор пользователя из localStorage имеет приоритет.
              var tgScheme = null;
              try {
                tgScheme = window.Telegram
                  && window.Telegram.WebApp
                  && window.Telegram.WebApp.colorScheme;
              } catch(e) {}
              theme = tgScheme === 'light' ? 'light' : 'dark';
              localStorage.setItem('theme', theme);
            }
            var root = document.documentElement;
            root.classList.remove('dark', 'bright');
            if (theme === 'dark')   root.classList.add('dark');
            if (theme === 'bright') root.classList.add('dark', 'bright');

            function initTG() {
              var tg = window.Telegram && window.Telegram.WebApp;
              if (!tg) return false;

              tg.ready();
              tg.expand();
              try { tg.requestFullscreen(); } catch(e) {}

              function disableSwipe() {
                try { tg.disableVerticalSwipes(); } catch(e) {}
              }
              disableSwipe();
              setTimeout(disableSwipe, 200);
              setTimeout(disableSwipe, 600);
              setTimeout(disableSwipe, 1500);
              setTimeout(disableSwipe, 3000);

              try { tg.BackButton.hide(); } catch(e) {}
              try { tg.enableClosingConfirmation(); } catch(e) {}

              var bg = theme === 'light' ? '#F0EDE4' : '#111318';
              try { tg.setHeaderColor(bg); }     catch(e) {}
              try { tg.setBackgroundColor(bg); } catch(e) {}
              try { tg.setBottomBarColor(bg); }  catch(e) {}

              var sysTop   = (tg.safeAreaInsets && tg.safeAreaInsets.top)               || 0;
              var tgTop    = (tg.contentSafeAreaInsets && tg.contentSafeAreaInsets.top)  || 0;
              var tgBottom = (tg.contentSafeAreaInsets && tg.contentSafeAreaInsets.bottom) || 0;
              var isFS     = tg.isFullscreen === true || tgTop > 0;
              root.style.setProperty('--header-pt',  (sysTop + tgTop + (isFS ? 65 : 12)) + 'px');
              root.style.setProperty('--scroll-pb',  (tgBottom + (isFS ? 100 : 84)) + 'px');
              root.style.setProperty('--nav-bottom', (tgBottom + (isFS ? 20 : 0)) + 'px');

              return (sysTop + tgTop) > 0;
            }

            var gotSafeArea = initTG();
            if (!gotSafeArea) {
              var attempts = 0;
              var poll = setInterval(function() {
                attempts++;
                gotSafeArea = initTG();
                if (gotSafeArea || attempts >= 100) clearInterval(poll);
              }, 30);
            }

            document.addEventListener('touchstart', function(e) {
              window.__touchStartY = e.touches[0].clientY;
              window.__touchStartX = e.touches[0].clientX;
            }, { passive: true });

            document.addEventListener('touchmove', function(e) {
              var dy = e.touches[0].clientY - (window.__touchStartY || 0);
              var dx = e.touches[0].clientX - (window.__touchStartX || 0);
              if (Math.abs(dx) > Math.abs(dy) + 5) return;
              if (dy <= 5) return;

              if ((window.__touchStartY || 0) < 80) {
                e.preventDefault();
                return;
              }

              var el = e.target;
              var scrollEl = null;
              while (el && el !== document.body) {
                if (el.hasAttribute && el.hasAttribute('data-radix-scroll-area-viewport')) { scrollEl = el; break; }
                if (el.classList && el.classList.contains('scroll-container')) { scrollEl = el; break; }
                var oy = window.getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) { scrollEl = el; break; }
                el = el.parentElement;
              }

              if (!scrollEl || scrollEl.scrollTop <= 0) e.preventDefault();
            }, { passive: false });

          })();
        ` }} />
      </head>
      <body className="antialiased">
        <main>{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
