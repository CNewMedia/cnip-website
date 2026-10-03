import {
  PHONE_DISPLAY,
  PHONE_HREF,
  isProduction,
  sha256,
  clientIp,
  originMatchesHost,
  checkRateLimit,
  claimSubmission,
  storeForReview,
  REVIEW_TTL_DAYS,
  logBlocked,
  storePreviewSubmission,
  verifyTurnstile,
  validate,
  suspicionReasons,
  fingerprint,
} from '../lib/contact-guard.js';

const PHONE_HINT = `Liever meteen contact? Bel ${PHONE_DISPLAY}.`;

const RESPONSES = {
  blocked: [400, 'We konden deze aanvraag niet verwerken. ' + PHONE_HINT],
  rate_limited: [429, 'Er werden op korte tijd te veel aanvragen verstuurd. Probeer het binnen enkele minuten opnieuw. ' + PHONE_HINT],
  expired: [409, 'De beveiligingscontrole is verlopen. Probeer opnieuw te verzenden; je gegevens blijven ingevuld.'],
  verification_unavailable: [503, 'De beveiligingscontrole is tijdelijk niet beschikbaar. Je aanvraag is nog niet verstuurd. Probeer het opnieuw. ' + PHONE_HINT],
  invalid: [422, 'Controleer de gemarkeerde velden.'],
  processing: [409, 'Deze aanvraag wordt op dit moment nog verwerkt. Wacht even en verstuur ze niet opnieuw. Geen bevestiging binnen een paar minuten? Bel ' + PHONE_DISPLAY + '.'],
  duplicate: [409, 'Deze aanvraag hebben we al succesvol ontvangen. Je hoeft ze niet opnieuw te versturen.'],
  review: [202, 'Je bericht is ontvangen, maar wordt eerst manueel nagekeken voor we antwoorden. Dringend? Bel ' + PHONE_DISPLAY + '.'],
  delivery_failed: [502, 'Je aanvraag kon niet worden verstuurd. Probeer het opnieuw. ' + PHONE_HINT],
  error: [500, 'Er ging iets mis; je aanvraag is niet verstuurd. Probeer het opnieuw. ' + PHONE_HINT],
  preview_ok: [200, 'Preview: aanvraag gevalideerd en bewaard als test. Er werd geen e-mail verstuurd en geen conversie gemeten.'],
};

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    raw = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 100000) req.destroy();
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('application/json')) return raw ? JSON.parse(raw) : {};
  return Object.fromEntries(new URLSearchParams(raw));
}

function formPathFrom(req) {
  try {
    const ref = req.headers.referer || req.headers.referrer;
    if (ref) return new URL(ref).pathname.slice(0, 100);
  } catch (_) {}
  return '';
}

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

async function sendResend({ email, name, company, phone, interest, message, source, reviewReasons }) {
  const apiKey = process.env.RESEND_API_KEY || process.env.CNIP;
  if (!apiKey) return { ok: false, reason: 'Resend API key ontbreekt' };

  const to = process.env.CONTACT_TO_EMAIL || 'christophe@cnip.be';
  const from = process.env.CONTACT_FROM_EMAIL || 'CNIP Website <website@cnip.be>';
  const review = Array.isArray(reviewReasons) && reviewReasons.length > 0;
  const heading = review ? 'CNIP-aanvraag ter beoordeling' : 'Nieuwe CNIP-aanvraag';
  const reviewNote = review
    ? `Deze aanvraag is niet automatisch als lead verwerkt en de afzender kreeg geen bedankpagina. Controleer ze voor je antwoordt. Ze blijft maximaal ${REVIEW_TTL_DAYS} dagen bewaard.`
    : '';

  const rows = [
    ...(review ? [['Reden beoordeling', reviewReasons.join('; ')]] : []),
    ['Naam', name],
    ['E-mail', email],
    ['Bedrijf', company],
    ['Telefoon', phone],
    ['Interesse', interest],
    ['Bron', source],
    ['Bericht', message],
  ].filter(([, value]) => value);

  const html = `
    <h2>${heading}</h2>
    ${reviewNote ? `<p>${escapeHtml(reviewNote)}</p>` : ''}
    <table cellpadding="6" cellspacing="0" border="0">
      ${rows.map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${escapeHtml(value).replaceAll('\n', '<br>')}</td></tr>`).join('')}
    </table>
  `;
  const text = [heading, ...(reviewNote ? ['', reviewNote] : []), '', ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `${review ? '[Ter beoordeling] CNIP-aanvraag' : 'Nieuwe CNIP-aanvraag'}${company ? ` | ${company.replace(/[\r\n]+/g, ' ')}` : ''}`,
      html,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Resend fout ${response.status}: ${await response.text()}`);
  return { ok: true };
}

function respond(req, res, status, extra = {}) {
  const [code, message] = RESPONSES[status];
  if (extra.retryAfter) res.setHeader('Retry-After', String(extra.retryAfter));
  res.setHeader('Cache-Control', 'no-store');

  if (String(req.headers.accept || '').includes('application/json')) {
    return res.status(code).json({ status, message, ...(extra.fields ? { fields: extra.fields } : {}) });
  }

  const details = extra.fields ? `<ul>${Object.values(extra.fields).map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(code).send(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>CNIP contactformulier</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5"><h1 style="font-size:1.4rem">CNIP contactformulier</h1><p>${escapeHtml(message)}</p>${details}<p><a href="javascript:history.back()">Terug naar het formulier</a> · <a href="${PHONE_HREF}">Bel ${PHONE_DISPLAY}</a> · <a href="mailto:info@cnip.be">info@cnip.be</a></p></body></html>`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const ip = clientIp(req);
  const ipHash = sha256(ip).slice(0, 16);
  const path = formPathFrom(req);
  const block = async (reason) => {
    console.warn('CNIP contactformulier geblokkeerd:', reason, path);
    await logBlocked({ ts: new Date().toISOString(), reason, path, ipHash });
    return respond(req, res, 'blocked');
  };

  try {
    // Before any early rejection, so repeated trivial bot requests cannot bypass the limit or flood the block log.
    const ipLimit = await checkRateLimit('ip', ip);
    if (ipLimit.limited) return respond(req, res, 'rate_limited', { retryAfter: ipLimit.retryAfter });

    if (!originMatchesHost(req)) return block('origin wijkt af');

    let body;
    try {
      body = await parseBody(req);
    } catch (_) {
      return block('onleesbare body');
    }

    if (String(body.botcheck || '').trim() !== '') return block('honeypot ingevuld');

    const { fields, errors, valid } = validate(body);
    if (!valid) return respond(req, res, 'invalid', { fields: errors });

    const verification = await verifyTurnstile(String(body['cf-turnstile-response'] || ''), ip);
    if (verification.outcome === 'bot') return block(`turnstile: ${verification.detail}`);
    if (verification.outcome === 'expired') return respond(req, res, 'expired');
    if (verification.outcome === 'unavailable') {
      console.error('CNIP contactformulier: Turnstile niet beschikbaar:', verification.detail);
      return respond(req, res, 'verification_unavailable');
    }

    const emailLimit = await checkRateLimit('email', fields.email);
    if (emailLimit.limited) return respond(req, res, 'rate_limited', { retryAfter: emailLimit.retryAfter });

    const claim = await claimSubmission(fingerprint(fields));
    if (claim.duplicate) {
      if (claim.state === 'pending') return respond(req, res, 'processing');
      return respond(req, res, claim.state === 'review' ? 'review' : 'duplicate');
    }

    const source = fields.subject || (path ? `CNIP website: ${path}` : 'CNIP website');
    const record = { ts: new Date().toISOString(), path, ipHash, source, ...fields };

    const reasons = suspicionReasons(fields, body);
    if (reasons.length) {
      const stored = await storeForReview({ ...record, reasons });
      // Production also mails the reviewer, so a held request is never only sitting in Redis.
      let notified = false;
      if (isProduction()) {
        try {
          notified = (await sendResend({ ...fields, source, reviewReasons: reasons })).ok;
        } catch (error) {
          console.error('CNIP contactformulier: beoordelingsmelding mislukt', error);
        }
      }
      if (!stored && !notified) {
        await claim.release();
        return respond(req, res, 'error');
      }
      if (isProduction() && !notified) console.error('CNIP contactformulier: ter beoordeling bewaard zonder e-mailmelding', path);
      await claim.complete('review');
      console.warn('CNIP contactformulier: ter beoordeling:', reasons.join('; '), path, { stored, notified });
      return respond(req, res, 'review');
    }

    if (!isProduction()) {
      const stored = await storePreviewSubmission(record);
      if (!stored) {
        await claim.release();
        return respond(req, res, 'error');
      }
      await claim.complete('done');
      return respond(req, res, 'preview_ok');
    }

    let delivered;
    try {
      delivered = await sendResend({ ...fields, source });
    } catch (error) {
      console.error('CNIP contactformulier: Resend mislukt', error);
      delivered = { ok: false };
    }
    if (!delivered.ok) {
      await claim.release();
      return respond(req, res, 'delivery_failed');
    }
    await claim.complete('done');

    // Conversiesignaal voor de bedankpagina: alleen na een echt verstuurde, niet-verdachte aanvraag.
    const ckyCookie = String(req.headers.cookie || '').match(/(?:^|;\s*)cookieyes-consent=([^;]+)/);
    let adsConsent = false;
    try {
      adsConsent = !!ckyCookie && /advertisement:yes/.test(decodeURIComponent(ckyCookie[1]));
    } catch (_) {}
    const leadValue = adsConsent ? sha256(fields.email) : 'nc';
    res.setHeader('Set-Cookie', `cnip_lead=${leadValue}.${encodeURIComponent(path || '/')}; Max-Age=300; Path=/; SameSite=Lax; Secure`);
    res.setHeader('Cache-Control', 'no-store');

    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(200).json({ status: 'ok', redirect: '/bedankt.html' });
    }
    res.setHeader('Location', '/bedankt.html');
    return res.status(303).end();
  } catch (error) {
    console.error('CNIP contactformulier fout:', error);
    return respond(req, res, 'error');
  }
}
