import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  // Genereer een willekeurige state voor CSRF-bescherming
  const state = crypto.randomBytes(16).toString('hex');

  // Sla state op in KV (geldig voor 10 minuten)
  await kv.set('mollie_oauth_state', state, { ex: 600 });

  const params = new URLSearchParams({
    client_id: process.env.MOLLIE_CLIENT_ID,
    redirect_uri: process.env.MOLLIE_REDIRECT_URI,
    response_type: 'code',
    scope: 'payments.read payments.write',
    state,
  });

  const mollieAuthUrl = `https://www.mollie.com/oauth2/authorize?${params.toString()}`;

  return res.redirect(mollieAuthUrl);
}
