# ByNekruz

Telegram Mini App для студентов-медиков КрасГМУ: вопросы, тесты, задачи и
билеты по предметам, платный доступ через витрину (проба → чек по СБП →
подтверждение админом), интеграция с личным кабинетом krasgmu.ru, ИИ-разборы.

## Стек и запуск

Next.js 14.2 (App Router + Pages Router), React 18, TypeScript strict,
Tailwind. Хранилище — только Redis (ioredis на Timeweb, Upstash как запасной).

```bash
npm ci
npm run dev            # нужен Redis в env (см. .env.example)
npx tsc --noEmit --incremental false
npm test               # Vitest: блокировка пользователя, «Скинул чек», контент
npm run build && npm run check:bundle
```

## Деплой

Push в `main` сразу деплоится на Timeweb App Platform (`npm run build` /
`npm start`). CI (`.github/workflows/ci.yml`) на тот же push гоняет `tsc`,
тесты, сборку и проверку бандла — зелёный CI перед пушем обязателен.
Переменные окружения — в `.env.example`.

## Правила, которые нельзя нарушать

- **Контент из `src/data` не должен попадать в клиентский бандл.** Клиентский
  компонент не импортирует значения из модулей, которые читают JSON
  (`subjectCatalog` через `require`, `examTickets`, `curriculum`/
  `curriculumSeed`) — только `import type`. Клиент получает контент через
  `/api/subject-data` (в т.ч. `type: 'tickets'`). `npm run check:bundle`
  ловит утечку после сборки.
- **Пользователь (`user_id:{tgId}`) пишется только под блокировкой** —
  `withUserLock` / `updateUser` из `src/lib/userLock.ts`. Иначе параллельный
  запрос затирает чужую запись (например, подтверждение оплаты админом).
  `auth.ts` и действия `admin-users` уже выполняются под блокировкой целиком.
- **Авторизация API** — `resolveRequestIdentity` / `verifyApiStudyUser`
  (Telegram initData или cookie-сессия после входа через Telegram). Whitelist
  (`sub_whitelist`) снимает только проверку подписки на канал, личность он
  не подтверждает. Админ-роуты — `verifyAdminRequest`.
- **Час доступа после «Скинул чек»** даётся один раз на раздел предмета
  (`previewModuleTrustUsed`); повторная заявка ждёт админа без доступа.
- **Группа студента** закрепляется при первом вводе (`lockedStudyGroup`),
  сменить её может только админ.
- **Сбои** — `alertAdmin(kind, title, detail)` из `src/lib/alertAdmin.ts`
  (сообщение админу в Telegram, не чаще раза в 15 мин на kind).
  `/api/health` — для внешнего мониторинга.
- **Вход на krasgmu.ru** идёт через Browserless (бесплатный тариф, 1000 units
  в месяц): лимиты и одна попытка перелогина на студента —
  `src/lib/krasgmu/loginGuard.ts`.

## Контент

JSON по предметам — в `src/data`, конфиг дисциплин — `src/lib/subjects.ts`.
`tests/contentData.test.ts` проверяет каждый файл (id, вопрос/ответ, ключ
теста совпадает с вариантом). Тесты без ключа в исходнике перечислены в
`KNOWN_TESTS_WITHOUT_ANSWER` — исправил ответ, убери id из списка.
Python-скрипты в `scripts/` — разовая сборка контента из PDF/DOCX.
