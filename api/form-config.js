import { turnstileConfig, TURNSTILE_ACTION, PHONE_DISPLAY, PHONE_HREF, CONTACT_EMAIL } from '../lib/contact-guard.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const { siteKey, testing } = turnstileConfig();
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return res.status(200).json({
    siteKey,
    action: TURNSTILE_ACTION,
    testing,
    phone: { display: PHONE_DISPLAY, href: PHONE_HREF },
    email: CONTACT_EMAIL,
  });
}
