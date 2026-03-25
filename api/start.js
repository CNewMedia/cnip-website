export default async function handler(req, res) {
  const crypto = await import('crypto');
  const state = crypto.default.randomBytes(16).toString('hex');

  // Sla state op in een cookie voor CSRF validatie
  res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`);

  const params = new URLSearchParams({
    client_id: process.env.MOLLIE_CLIENT_ID,
    redirect_uri: process.env.MOLLIE_REDIRECT_URI,
    response_type: 'code',
    scope: 'payments.read payments.write profiles.read organizations.read',
    state,
  });

  return res.redirect(`https://my.mollie.com/oauth2/authorize?${params.toString()}`);
}
