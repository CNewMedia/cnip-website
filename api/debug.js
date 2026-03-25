export default async function handler(req, res) {
  return res.status(200).json({
    client_id: process.env.MOLLIE_CLIENT_ID || 'NIET GEVONDEN',
    redirect_uri: process.env.MOLLIE_REDIRECT_URI || 'NIET GEVONDEN',
    frontend_url: process.env.FRONTEND_URL || 'NIET GEVONDEN',
  });
}
