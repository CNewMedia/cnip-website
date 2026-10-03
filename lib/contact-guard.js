import { createHash, randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

export const PHONE_DISPLAY = '+32 9 298 57 20';
export const PHONE_HREF = 'tel:+3292985720';
export const TURNSTILE_ACTION = 'contact';

// Cloudflare's officiële testsleutels: altijd geldig, nooit echte verificatie.
const TEST_SITE_KEY = '1x00000000000000000000AA';
const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export const isProduction = () => process.env.VERCEL_ENV === 'production';
const envName = () => process.env.VERCEL_ENV || 'development';

export function turnstileConfig() {
  if (isProduction()) {
    return {
      siteKey: process.env.TURNSTILE_SITE_KEY || '',
      secretKey: process.env.TURNSTILE_SECRET_KEY || '',
      testing: false,
    };
  }
  return {
    siteKey: process.env.TURNSTILE_TEST_SITE_KEY || TEST_SITE_KEY,
    secretKey: process.env.TURNSTILE_TEST_SECRET_KEY || TEST_SECRET_KEY,
    testing: true,
  };
}

function allowedHostnames() {
  const list = process.env.TURNSTILE_ALLOWED_HOSTNAMES || 'cnip.be,www.cnip.be';
  return list.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

export const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

export function clientIp(req) {
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return fwd.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

export function requestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
}

export function originMatchesHost(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    return new URL(origin).host.toLowerCase() === requestHost(req);
  } catch (_) {
    return false;
  }
}

// ---------- Gedeelde opslag (Upstash Redis) ----------

let redisClient;
function redis() {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  if (!redisClient) console.error('CNIP contactformulier: Redis niet geconfigureerd; rate limiting en deduplicatie staan uit.');
  return redisClient;
}

const key = suffix => `cnip:contact:${envName()}:${suffix}`;

let limiters;
function getLimiters() {
  if (limiters !== undefined) return limiters;
  const client = redis();
  limiters = client
    ? {
        ip: new Ratelimit({ redis: client, limiter: Ratelimit.slidingWindow(5, '10 m'), prefix: key('rl:ip'), timeout: 2000 }),
        email: new Ratelimit({ redis: client, limiter: Ratelimit.slidingWindow(3, '1 h'), prefix: key('rl:email'), timeout: 2000 }),
      }
    : null;
  return limiters;
}

// Bij een storing van de opslag laten we de aanvraag door: een gemiste lead weegt zwaarder dan één extra spambericht.
export async function checkRateLimit(kind, identifier) {
  const l = getLimiters();
  if (!l) return { limited: false };
  try {
    const { success, reset } = await l[kind].limit(sha256(identifier));
    return { limited: !success, retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  } catch (error) {
    console.error('CNIP contactformulier: rate limit niet beschikbaar', error);
    return { limited: false };
  }
}

const DEDUP_TTL_SECONDS = 15 * 60;
// Short, so a crashed or timed-out request does not block a genuine retry for the full dedup window.
const PENDING_TTL_SECONDS = 90;

const noopClaim = { duplicate: false, release: async () => {}, complete: async () => {} };

// Claim states: "pending" while being processed; "done" or "review" once the request was handled.
export async function claimSubmission(fingerprint) {
  const client = redis();
  if (!client) return noopClaim;
  const k = key(`dedup:${fingerprint}`);
  const release = async () => { try { await client.del(k); } catch (_) {} };
  const complete = async state => { try { await client.set(k, state, { ex: DEDUP_TTL_SECONDS }); } catch (_) {} };
  try {
    const set = await client.set(k, 'pending', { nx: true, ex: PENDING_TTL_SECONDS });
    if (set !== null) return { duplicate: false, release, complete };
    const current = await client.get(k);
    const state = current === 'review' ? 'review' : current === 'done' ? 'done' : 'pending';
    return { duplicate: true, state, release: async () => {}, complete: async () => {} };
  } catch (error) {
    console.error('CNIP contactformulier: deduplicatie niet beschikbaar', error);
    return noopClaim;
  }
}

// Each record is its own key with a fixed TTL, so no record outlives its retention period;
// the index only holds ids and is pruned on every write.
async function storeRecord(kind, record, { max, ttlDays }) {
  const client = redis();
  if (!client) return false;
  const ttl = ttlDays * 86400;
  const now = Date.now();
  const id = `${now}-${randomUUID().slice(0, 8)}`;
  const indexKey = key(`${kind}:index`);
  try {
    const p = client.pipeline();
    p.set(key(`${kind}:item:${id}`), JSON.stringify({ id, ...record }), { ex: ttl });
    p.zadd(indexKey, { score: now, member: id });
    p.zremrangebyscore(indexKey, 0, now - ttl * 1000);
    p.zremrangebyrank(indexKey, 0, -(max + 1));
    p.expire(indexKey, ttl);
    await p.exec();
    return true;
  } catch (error) {
    console.error(`CNIP contactformulier: opslaan in ${kind} mislukt`, error);
    return false;
  }
}

export const REVIEW_TTL_DAYS = 30;
export const storeForReview = record => storeRecord('review', record, { max: 500, ttlDays: REVIEW_TTL_DAYS });
export const logBlocked = record => storeRecord('blocked', record, { max: 300, ttlDays: 7 });
export const storePreviewSubmission = record => storeRecord('submissions', record, { max: 100, ttlDays: 7 });

// ---------- Turnstile ----------

export async function verifyTurnstile(token, ip) {
  const { secretKey, testing } = turnstileConfig();
  if (!secretKey) return { outcome: 'unavailable', detail: 'secret ontbreekt' };
  if (!token) return { outcome: 'bot', detail: 'geen token' };
  if (token.length > 2048) return { outcome: 'bot', detail: 'token te lang' };

  let data;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { outcome: 'unavailable', detail: `siteverify ${response.status}` };
    data = await response.json();
  } catch (error) {
    return { outcome: 'unavailable', detail: error.name || 'netwerkfout' };
  }

  const codes = data['error-codes'] || [];
  if (!data.success) {
    if (codes.includes('timeout-or-duplicate')) return { outcome: 'expired', detail: codes.join(',') };
    if (codes.some(c => c === 'internal-error' || c.startsWith('missing-input-secret') || c.startsWith('invalid-input-secret'))) {
      return { outcome: 'unavailable', detail: codes.join(',') };
    }
    return { outcome: 'bot', detail: codes.join(',') || 'mislukt' };
  }

  // Testsleutels geven altijd hostname "example.com" en geen action terug.
  if (testing && data.metadata?.result_with_testing_key) return { outcome: 'ok', detail: 'testsleutel' };

  if (!allowedHostnames().includes(String(data.hostname || '').toLowerCase())) {
    return { outcome: 'bot', detail: `hostname ${data.hostname}` };
  }
  if (data.action !== TURNSTILE_ACTION) return { outcome: 'bot', detail: `action ${data.action}` };
  return { outcome: 'ok', detail: 'geverifieerd' };
}

// ---------- Invoervalidatie ----------

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function text(value, { max, multiline = false }) {
  if (value === undefined || value === null) return '';
  let v = String(Array.isArray(value) ? value[0] : value).replace(CONTROL_CHARS, '');
  v = multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n') : v.replace(/\s+/g, ' ');
  v = v.trim();
  return v.length > max ? null : v;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const PHONE_RE = /^[+()\d\s./-]{6,30}$/;

export function validate(body) {
  const errors = {};
  const fields = {
    name: text(body.name ?? body.naam, { max: 120 }),
    email: text(body.email, { max: 254 }),
    company: text(body.company ?? body.bedrijf, { max: 200 }),
    phone: text(body.phone ?? body.telefoon, { max: 30 }),
    interest: text(body.interest ?? body.vraag, { max: 300 }),
    message: text(body.message ?? body.bericht, { max: 5000, multiline: true }),
    subject: text(body.subject ?? body.form_name, { max: 250 }) || '',
  };

  if (fields.name === null) errors.name = 'Je naam is te lang (maximaal 120 tekens).';
  else if (fields.name.length < 2) errors.name = 'Vul je naam in.';

  if (fields.email === null) errors.email = 'Dit e-mailadres is te lang.';
  else {
    fields.email = fields.email.toLowerCase();
    if (!EMAIL_RE.test(fields.email) || fields.email.includes('..')) errors.email = 'Vul een geldig e-mailadres in, bijvoorbeeld naam@bedrijf.be.';
  }

  if (fields.company === null) errors.company = 'De bedrijfsnaam is te lang (maximaal 200 tekens).';
  if (fields.interest === null) fields.interest = '';
  if (fields.phone === null || (fields.phone && (!PHONE_RE.test(fields.phone) || (fields.phone.match(/\d/g) || []).length < 6))) {
    errors.phone = 'Vul een geldig telefoonnummer in of laat het veld leeg.';
  }
  if (fields.message === null) errors.message = 'Je bericht is te lang (maximaal 5000 tekens).';

  return { fields, errors, valid: Object.keys(errors).length === 0 };
}

// ---------- Inhoudelijke signalen (nooit op naam, taal of e-mailprovider) ----------

const URL_PATTERN = String.raw`\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|ru|xyz|top|info|biz|shop|site|online|me)\/\S*`;
const urlRe = () => new RegExp(URL_PATTERN, 'gi');

export function suspicionReasons(fields, body) {
  const reasons = [];
  const message = fields.message || '';
  const links = (message.match(urlRe()) || []).length;
  if (links >= 3) reasons.push(`${links} links in bericht`);
  if (/<a\s|<\/a>|\[url[=\]]|\[link[=\]]/i.test(message)) reasons.push('HTML- of BBCode-links');
  if (urlRe().test(`${fields.name} ${fields.company}`)) reasons.push('link in naam of bedrijf');
  if (links > 0 && message.replace(urlRe(), '').trim().length < 5) reasons.push('bericht bestaat alleen uit een link');
  // Speed is only a supporting signal: autofill and password managers make fast genuine submissions normal.
  const elapsed = Number(body.fe);
  if (reasons.length && Number.isFinite(elapsed) && elapsed > 0 && elapsed < 1200) reasons.push(`verzonden na ${Math.round(elapsed)} ms`);
  return reasons;
}

export function fingerprint(fields) {
  return sha256([fields.email, fields.message.toLowerCase().replace(/\s+/g, ' '), fields.interest, fields.phone].join('|'));
}
