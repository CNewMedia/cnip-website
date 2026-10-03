import { REVIEW_TTL_DAYS } from './contact-guard.js';

export const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export async function sendResend({ email, name, company, phone, interest, message, source, reviewReasons, reviewId }) {
  const apiKey = process.env.RESEND_API_KEY || process.env.CNIP;
  if (!apiKey) throw new Error('Resend API key ontbreekt');

  const to = process.env.CONTACT_TO_EMAIL || 'christophe@cnip.be';
  const from = process.env.CONTACT_FROM_EMAIL || 'CNIP Website <website@cnip.be>';
  const review = Array.isArray(reviewReasons) && reviewReasons.length > 0;
  const heading = review ? 'CNIP-aanvraag ter beoordeling' : 'Nieuwe CNIP-aanvraag';
  const reviewNote = review
    ? `Deze aanvraag is niet automatisch als lead verwerkt en de afzender kreeg geen bedankpagina. Controleer ze voor je antwoordt. Ze blijft maximaal ${REVIEW_TTL_DAYS} dagen bewaard en is ook zichtbaar op https://cnip.be/api/beoordeling.`
    : '';

  const rows = [
    ...(review ? [['Reden beoordeling', reviewReasons.join('; ')]] : []),
    ...(reviewId ? [['Referentie', reviewId]] : []),
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Same review record → same key, so a retry after an ambiguous failure cannot mail twice within Resend's 24h window.
      ...(reviewId ? { 'Idempotency-Key': `cnip-review-${reviewId}` } : {}),
    },
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

  if (!response.ok) throw new Error(`Resend fout ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return { ok: true };
}
