// api/polotab-token.js
// Returns a short-lived Polotab session token for the dashboard
// Credentials stored server-side in Vercel env vars

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.canica.fun');

  const API_KEY = process.env.POLOTAB_API_KEY;
  const RID     = '57feae50-e490-435f-b821-4dc86e89aadc';

  if (!API_KEY) return res.status(500).json({ error: 'Missing POLOTAB_API_KEY' });

  try {
    const authRes = await fetch('https://api.polotab.com/auth/v1/restaurants/token', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: RID })
    });
    const data = await authRes.json();
    if (!data.token) return res.status(401).json({ error: 'Auth failed', detail: data });

    // Cache for 4 minutes (token lasts longer but we refresh often)
    res.setHeader('Cache-Control', 'private, max-age=240');
    res.status(200).json({ token: data.token });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
