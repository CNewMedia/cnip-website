export default async function handler(req, res) {
  const crypto = await import('crypto');
  const state = crypto.default.randomBytes(16).toString('hex');

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
