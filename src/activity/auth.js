/**
 * Activity authentication.
 *
 * The browser inside Discord calls `authorize()` through the Embedded App SDK
 * and gets a one-time OAuth2 code. It posts that code here; we exchange it for
 * an access token, look up who the user is (and their nickname in the guild
 * the Activity runs in), and hand back:
 *   - the access token, which the SDK needs for `authenticate()`
 *   - a signed session the browser presents when opening its WebSocket
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://discord.com/api/v10';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

export function signSession(payload, secret) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(token, secret) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.user?.id || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function avatarUrl(user, member) {
  if (member?.avatar && member.guildId) {
    return `https://cdn.discordapp.com/guilds/${member.guildId}/users/${user.id}/avatars/${member.avatar}.png?size=64`;
  }
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  return null;
}

/**
 * @returns {Promise<{access_token:string, session:string, user:object}>}
 */
export async function exchangeCode({ code, guildId }, config) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { access_token } = await res.json();

  const meRes = await fetch(`${API}/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
  if (!meRes.ok) throw new Error(`users/@me failed (${meRes.status})`);
  const me = await meRes.json();

  let member = null;
  if (guildId && /^\d{5,30}$/.test(guildId)) {
    const mRes = await fetch(`${API}/users/@me/guilds/${guildId}/member`, { headers: { authorization: `Bearer ${access_token}` } });
    if (mRes.ok) member = { ...(await mRes.json()), guildId };
  }

  const user = {
    id: me.id,
    name: member?.nick || me.global_name || me.username,
    avatar: avatarUrl(me, member),
  };
  const session = signSession({ user, guildId: member ? guildId : null, exp: Date.now() + SESSION_TTL_MS }, sessionSecret(config));
  return { access_token, session, user };
}

/** Development-only login that fabricates a user. */
export function devSession({ name }, config) {
  const clean = String(name ?? 'Dev').replace(/[^\w .-]/g, '').slice(0, 24) || 'Dev';
  const id = `dev-${clean.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const user = { id, name: clean, avatar: null };
  return { session: signSession({ user, guildId: null, exp: Date.now() + SESSION_TTL_MS }, sessionSecret(config)), user };
}

export function sessionSecret(config) {
  return config.sessionSecret || config.clientSecret;
}
