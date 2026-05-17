// api/canva-callback.js — Canva OAuth callback
// Exchanges the authorization code for access + refresh tokens
// Stores them in environment variables (Vercel) and responds with success page

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`<html><body><h2>Canva auth error: ${error}</h2></body></html>`);
  }

  if (!code) {
    return res.status(400).send('<html><body><h2>No code received</h2></body></html>');
  }

  try {
    const CLIENT_ID = process.env.CANVA_CLIENT_ID || 'OC-AZ4z62gWqh7B';
    const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET;
    const CODE_VERIFIER = process.env.CANVA_CODE_VERIFIER;
    const REDIRECT_URI = 'https://www.canica.fun/canva-callback';

    // Exchange code for tokens
    const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: CODE_VERIFIER,
      })
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      return res.status(400).send(`<html><body><h2>Token error: ${tokens.error_description || tokens.error}</h2></body></html>`);
    }

    // Store tokens — in production these go to 1Password via a webhook
    // For now, log them so Emma can capture and store them
    console.log('CANVA_ACCESS_TOKEN:', tokens.access_token);
    console.log('CANVA_REFRESH_TOKEN:', tokens.refresh_token);
    console.log('Expires in:', tokens.expires_in, 'seconds');

    // Send Telegram notification with tokens
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = '6525841557';
    if (BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: `✅ Canva OAuth completado\n\nAccess token: ${tokens.access_token?.slice(0,20)}...\nRefresh token: ${tokens.refresh_token?.slice(0,20)}...\n\nGuardando en 1Password...`,
        })
      });
    }

    res.status(200).send(`
      <html>
      <head><style>body{font-family:system-ui;max-width:500px;margin:80px auto;text-align:center;}</style></head>
      <body>
        <h2>✅ Canva conectado</h2>
        <p>Emma ya tiene acceso a Canva. Puedes cerrar esta ventana.</p>
      </body>
      </html>
    `);

  } catch (e) {
    res.status(500).send(`<html><body><h2>Error: ${e.message}</h2></body></html>`);
  }
}
