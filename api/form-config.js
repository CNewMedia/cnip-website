import { waitUntil } from '@vercel/functions';
import { turnstileConfig, TURNSTILE_ACTION, PHONE_DISPLAY, PHONE_HREF, CONTACT_EMAIL, isProduction } from '../lib/contact-guard.js';
import { retryPendingNotifications } from '../lib/review-notify.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  // Every page view with a form also gives open review notifications a rate-limited retry chance.
  if (isProduction()) waitUntil(retryPendingNotifications());
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
