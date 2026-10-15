// Эксперимент: можно ли войти на krasgmu.ru обычным HTTP-запросом, без Browserless.
//
// Запуск (Node 20+), логин и пароль спросит сам — в историю терминала они не попадут:
//   node scripts/krasgmu-login-probe.mjs
//
// Пробует две формы входа (главная страница и страница деканата), редиректы
// проходит вручную и собирает cookie с каждого ответа — в старой fetch-версии
// fetch сам шёл по редиректу, и cookie с промежуточного 302 терялись.
// Значения cookie и пароль не печатаются. Останавливается на первом успехе.

import readline from 'node:readline';

const BASE = 'https://krasgmu.ru';
const DEAN_URL = `${BASE}/index.php?page%5Borg%5D=dean`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = s => {
      if (s.startsWith(question)) rl.output.write(question);
      else if (s === '\r\n' || s === '\n') rl.output.write(s);
    };
  }
  return new Promise(resolve => rl.question(question, a => { rl.close(); if (hidden) console.log(); resolve(a.trim()); }));
}

const mask = v => (v.length <= 4 ? '****' : `${v.slice(0, 2)}…(${v.length})`);

async function request(jar, url, { method = 'GET', body, referer } = {}) {
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  for (let hop = 0; hop < 8; hop++) {
    const headers = {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': referer ? 'same-origin' : 'none',
      'sec-fetch-user': '?1',
    };
    if (referer) headers.Referer = referer;
    if (currentMethod === 'POST') {
      headers.Origin = BASE;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(current, { method: currentMethod, headers, body: currentBody, redirect: 'manual' });
    const setNames = [];
    for (const raw of res.headers.getSetCookie()) {
      const seg = raw.split(';')[0];
      const eq = seg.indexOf('=');
      if (eq > 0) {
        const name = seg.slice(0, eq).trim();
        const value = seg.slice(eq + 1).trim();
        if (value && value !== 'deleted') jar[name] = value;
        else delete jar[name];
        setNames.push(name);
      }
    }
    const location = res.headers.get('location');
    console.log(`    ${currentMethod} ${current.replace(BASE, '') || '/'} → ${res.status}`
      + (location ? ` → ${location}` : '')
      + (setNames.length ? `  [Set-Cookie: ${setNames.join(', ')}]` : ''));

    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      if (res.status !== 307 && res.status !== 308) { currentMethod = 'GET'; currentBody = undefined; }
      referer = referer ?? url;
      continue;
    }
    return { status: res.status, body: await res.text(), url: current };
  }
  throw new Error('слишком много редиректов');
}

async function verify(jar, login) {
  const id = login.replace(/^\D+/, '');
  const res = await request(jar, `${BASE}/index.php?page%5Bcommon%5D=user&id=${id}&cat=student&what=mark`, { referer: DEAN_URL });
  const denied = /недостаточно прав доступа/i.test(res.body) || /name=['"]user_pass['"]/i.test(res.body);
  return res.status === 200 && !denied;
}

const variants = [
  {
    name: 'A. форма главной страницы (поле login = логин)',
    pageUrl: `${BASE}/`,
    postUrl: `${BASE}/`,
    fields: (l, p) => ({ login: l, user_name: l, user_pass: p }),
  },
  {
    name: 'B. форма деканата (login — кнопка, пустое)',
    pageUrl: DEAN_URL,
    postUrl: DEAN_URL,
    fields: (l, p) => ({ user_name: l, user_pass: p, login: '' }),
  },
];

const login = process.env.KRASGMU_LOGIN || await ask('Логин krasgmu.ru: ');
const password = process.env.KRASGMU_PASSWORD || await ask('Пароль: ', true);
if (!login || !password) { console.error('Нужны логин и пароль'); process.exit(1); }

let success = null;
for (const v of variants) {
  console.log(`\n${v.name}`);
  const jar = {};
  try {
    await request(jar, v.pageUrl);
    const res = await request(jar, v.postUrl, {
      method: 'POST',
      body: new URLSearchParams(v.fields(login, password)).toString(),
      referer: v.pageUrl,
    });
    console.log(`    cookie после входа: ${Object.entries(jar).map(([k, val]) => `${k}=${mask(val)}`).join(', ')}`);
    if (/неверный (логин|пароль)/i.test(res.body)) {
      console.log('    ✗ сайт ответил «неверный логин или пароль» — проверь данные, дальше не пробую');
      process.exit(1);
    }
    if (!jar['krasgmu.auth']) {
      console.log('    ✗ cookie krasgmu.auth не выдан');
    } else if (await verify(jar, login)) {
      console.log('    ✓ ВХОД РАБОТАЕТ: krasgmu.auth есть, страница оценок открылась');
      success = v.name;
      break;
    } else {
      console.log('    ~ krasgmu.auth выдан, но страница оценок не открылась');
    }
  } catch (e) {
    console.log(`    ✗ ошибка: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise(r => setTimeout(r, 3000));
}

console.log(success
  ? `\nИтог: вход без браузера возможен (${success}). Скинь этот вывод в чат.`
  : '\nИтог: обычным запросом войти не удалось. Скинь этот вывод в чат — следующий шаг: имитация TLS-отпечатка Chrome.');
