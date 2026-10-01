import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_URL = 'https://oauth.telegram.org/auth';
const TOKEN_URL = 'https://oauth.telegram.org/token';
const JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';
const ISSUER = 'https://oauth.telegram.org';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function buildTelegramAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export type TelegramOidcProfile = {
  telegramId: string;
  name: string | null;
  username: string | null;
  picture: string | null;
};

/**
 * В ID-токене Telegram `sub` — непрозрачный идентификатор, свой для каждого
 * client_id, а не настоящий числовой Telegram ID. Настоящий ID (тот же, что
 * отдают классический Login Widget и initData мини-аппа, и который принимают
 * методы Bot API вроде getChatMember) лежит в claim `id` (при scope=profile).
 * Поэтому для сопоставления с уже существующими аккаунтами/подпиской на канал
 * берём именно `id`, а на `sub` опираемся только если `id` почему-то отсутствует.
 */
function extractTelegramId(payload: Record<string, unknown>): string | null {
  const idClaim = payload.id;
  if ((typeof idClaim === 'string' || typeof idClaim === 'number') && /^\d+$/.test(String(idClaim))) {
    return String(idClaim);
  }
  const sub = payload.sub;
  if ((typeof sub === 'string' || typeof sub === 'number') && /^\d+$/.test(String(sub))) {
    console.warn('[telegramOidc] ID-токен без claim "id" — используем "sub" как запасной вариант');
    return String(sub);
  }
  return null;
}

export async function exchangeTelegramCode(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<TelegramOidcProfile> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code_verifier: opts.codeVerifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram token exchange failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error('Telegram token response has no id_token');

  const { payload } = await jwtVerify(data.id_token, getJwks(), {
    issuer: ISSUER,
    audience: opts.clientId,
  });

  const telegramId = extractTelegramId(payload as Record<string, unknown>);
  if (!telegramId) throw new Error('Telegram ID token has no usable id/sub claim');

  return {
    telegramId,
    name: typeof payload.name === 'string' ? payload.name : null,
    username: typeof payload.preferred_username === 'string' ? payload.preferred_username : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}
