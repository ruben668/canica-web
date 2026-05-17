// api/canva-callback.js — Canva OAuth callback
// Exchanges the authorization code for tokens and stores in 1Password via Telegram

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`<html><body><h2>Canva auth error: ${error}</h2></body></html>`);
  }

  if (!code) {
    return res.status(400).send('<html><body><h2>No code received</h2></body></html>');
  }

  try {
    const CLIENT_ID = process.env.CANVA_CLIENT_ID;
    const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET;
    const CODE_VERIFIER = process.env.CANVA_CODE_VERIFIER;
    const REDIRECT_URI = 'https://www.canica.fun/canva-callback';

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

    const ACCESS = tokens.access_token;
    const REFRESH = tokens.refresh_token;
    const EXPIRES = tokens.expires_in;

    // Send FULL tokens to Telegram so Emma can store them
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = '6525841557';

    const msg = `✅ Canva OAuth completado\n\nACCESS_TOKEN:\n${ACCESS}\n\nREFRESH_TOKEN:\n${REFRESH}\n\nExpira en: ${EXPIRES}s`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
    });

    res.status(200).send(`
      <html>
      <head><style>body{font-family:system-ui;max-width:500px;margin:80px auto;text-align:center;background:#FFF9F1;}</style></head>
      <body>
        <h2>✅ Canva conectado</h2>
        <p>Emma ya tiene acceso a Canva. Los tokens han sido enviados de forma segura.</p>
        <p style="color:#aaa;font-size:12px;">Puedes cerrar esta ventana.</p>
      </body>
      </html>
    `);

  } catch (e) {
    res.status(500).send(`<html><body><h2>Error: ${e.message}</h2></body></html>`);
  }
}
