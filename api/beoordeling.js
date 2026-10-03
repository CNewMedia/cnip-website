import { timingSafeEqual, createHash } from 'node:crypto';
import { clientIp, originMatchesHost, checkRateLimit, listReviewItems, REVIEW_TTL_DAYS } from '../lib/contact-guard.js';
import { escapeHtml } from '../lib/contact-mail.js';
import { retryNotification, AUTO_RETRY_MAX_ATTEMPTS } from '../lib/review-notify.js';

const digest = v => createHash('sha256').update(String(v)).digest();

function authorized(req) {
  const password = process.env.REVIEW_ADMIN_PASSWORD;
  if (!password || password.length < 12) return 'unconfigured';
  const match = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!match) return 'missing';
  let supplied = '';
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    supplied = decoded.slice(decoded.indexOf(':') + 1);
  } catch (_) {
    return 'wrong';
  }
  return timingSafeEqual(digest(supplied), digest(password)) ? 'ok' : 'wrong';
}

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
}

async function readForm(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : await new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 10000) req.destroy(); });
    req.on('end', () => resolve(d));
  });
  return Object.fromEntries(new URLSearchParams(raw));
}

const fmt = iso => {
  try {
    return new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(iso));
  } catch (_) {
    return iso || '';
  }
};

const MESSAGES = {
  sent: 'Melding verstuurd.',
  failed: 'Opnieuw versturen mislukt. De aanvraag blijft als openstaande melding bewaard.',
  expired: 'Deze aanvraag is na de bewaartermijn al verwijderd.',
  already_sent: 'Deze melding was al verstuurd.',
};

function page({ items, pendingIds, available, flash }) {
  const pending = new Set(pendingIds);
  const open = items.filter(i => pending.has(i.id));
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${escapeHtml(value).replaceAll('\n', '<br>')}</dd>` : '');
  const card = item => {
    const n = item.notification || {};
    const isOpen = pending.has(item.id);
    const badge = isOpen
      ? `<span class="badge open">Melding openstaand${n.attempts ? ` · ${n.attempts} mislukte poging${n.attempts === 1 ? '' : 'en'}` : ''}</span>`
      : n.status === 'sent' ? `<span class="badge ok">Gemeld ${escapeHtml(fmt(n.sentAt))}</span>` : '<span class="badge">Geen melding nodig</span>';
    return `<article>
      <header><strong>${escapeHtml(item.name || '(zonder naam)')}</strong> ${badge}<time datetime="${escapeHtml(item.ts)}">${escapeHtml(fmt(item.ts))}</time></header>
      <dl>
        ${row('Reden', (item.reasons || []).join('; '))}
        ${item.email ? `<dt>E-mail</dt><dd><a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a></dd>` : ''}
        ${row('Bedrijf', item.company)}${row('Telefoon', item.phone)}${row('Interesse', item.interest)}${row('Bron', item.source)}${row('Bericht', item.message)}
        ${isOpen && n.lastError ? row('Laatste fout', `${n.lastError} (${fmt(n.lastAttemptAt)})`) : ''}
        ${row('Referentie', item.id)}
      </dl>
      ${isOpen ? `<form method="post"><input type="hidden" name="action" value="retry"><input type="hidden" name="id" value="${escapeHtml(item.id)}"><button type="submit">Melding opnieuw versturen</button></form>` : ''}
    </article>`;
  };

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Aanvragen ter beoordeling | CNIP</title>
<style>
:root{--ink:#14213d;--muted:#5b6475;--line:#d9dde5;--bg:#f6f7f9;--warn:#b42318}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:52rem;margin:0 auto;padding:2rem 1.25rem 4rem;display:flex;flex-direction:column;gap:1.25rem}
h1{font-size:1.5rem;margin:0}h2{font-size:1.1rem;margin:.5rem 0 0}p{margin:0}.muted{color:var(--muted)}
.flash{padding:.75rem 1rem;border:1px solid var(--line);border-left:4px solid var(--ink);background:#fff;border-radius:6px}
article{background:#fff;border:1px solid var(--line);border-radius:8px;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.6rem}
article header{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}article time{margin-left:auto;color:var(--muted);font-size:.9rem}
dl{display:grid;grid-template-columns:8rem 1fr;gap:.25rem .75rem;margin:0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
.badge{font-size:.8rem;padding:.1rem .5rem;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.badge.open{border-color:var(--warn);color:var(--warn);font-weight:600}.badge.ok{color:var(--ink)}
button{font:inherit;font-weight:600;padding:.5rem .9rem;border-radius:6px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}a{color:var(--ink)}
.bar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between}
@media (max-width:560px){dl{grid-template-columns:1fr}dt{margin-top:.35rem}}
</style></head><body><main>
<div class="bar"><h1>Aanvragen ter beoordeling</h1>${open.length ? '<form method="post"><input type="hidden" name="action" value="retry-all"><button type="submit">Alle openstaande meldingen opnieuw versturen</button></form>' : ''}</div>
<p class="muted">Aanvragen die niet automatisch als lead verwerkt zijn. Ze blijven maximaal ${REVIEW_TTL_DAYS} dagen bewaard. Mislukte e-mailmeldingen worden automatisch tot ${AUTO_RETRY_MAX_ATTEMPTS} keer opnieuw geprobeerd, met minstens 10 minuten tussen pogingen.</p>
${flash ? `<p class="flash" role="status">${escapeHtml(flash)}</p>` : ''}
${available ? '' : '<p class="flash" role="alert">De opslag is momenteel niet bereikbaar.</p>'}
<h2>Openstaande meldingen (${open.length})</h2>
${open.length ? open.map(card).join('') : '<p class="muted">Geen openstaande meldingen.</p>'}
<h2>Alle aanvragen ter beoordeling (${items.length})</h2>
${items.length ? items.map(card).join('') : '<p class="muted">Geen aanvragen ter beoordeling.</p>'}
</main></body></html>`;
}

export default async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }

  const auth = authorized(req);
  if (auth === 'unconfigured') return res.status(503).send('Beoordelingspagina niet geconfigureerd: stel REVIEW_ADMIN_PASSWORD in (minstens 12 tekens).');
  if (auth !== 'ok') {
    if (auth === 'wrong') {
      const limit = await checkRateLimit('adminAuth', clientIp(req));
      if (limit.limited) {
        res.setHeader('Retry-After', String(limit.retryAfter));
        return res.status(429).send('Te veel mislukte aanmeldpogingen. Probeer later opnieuw.');
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="CNIP beoordeling", charset="UTF-8"');
    return res.status(401).send('Aanmelden vereist.');
  }

  if (req.method === 'POST') {
    // Basic auth is resent automatically by the browser, so cross-site form posts must be refused.
    if (!originMatchesHost(req)) return res.status(403).send('Verzoek geweigerd.');
    const form = await readForm(req);
    let msg = '';
    if (form.action === 'retry' && /^[\w-]{6,40}$/.test(String(form.id || ''))) {
      msg = MESSAGES[await retryNotification(form.id)] || '';
    } else if (form.action === 'retry-all') {
      const { pendingIds } = await listReviewItems(1);
      const outcomes = [];
      for (const id of pendingIds.slice(0, 20)) outcomes.push(await retryNotification(id));
      const sent = outcomes.filter(o => o === 'sent').length;
      const failed = outcomes.filter(o => o === 'failed').length;
      msg = `${sent} melding${sent === 1 ? '' : 'en'} verstuurd, ${failed} mislukt.`;
    }
    res.setHeader('Location', `/api/beoordeling${msg ? `?m=${encodeURIComponent(msg)}` : ''}`);
    return res.status(303).end();
  }

  let flash = '';
  try {
    flash = String(new URL(req.url, 'https://x').searchParams.get('m') || '').slice(0, 200);
  } catch (_) {}
  const data = await listReviewItems(200).catch(() => ({ available: false, items: [], pendingIds: [] }));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(page({ ...data, flash }));
}
