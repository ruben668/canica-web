// Vercel serverless — verify Stripe subscription + log check-in to Notion
// GET /api/verify?session=cs_xxx OR ?customer=cus_xxx

const NOTION_KEY = process.env.NOTION_KEY;
const CHECKINS_DB = process.env.NOTION_CHECKINS_DB;

async function logCheckin(data) {
  if (!NOTION_KEY || !CHECKINS_DB) return;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });

  // Check how many times this customer checked in this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  let monthCount = 0;
  let totalCount = 0;
  try {
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${CHECKINS_DB}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: { property: 'Customer ID', rich_text: { equals: data.customer_id } },
        sorts: [{ property: 'Fecha', direction: 'descending' }],
        page_size: 100
      })
    });
    const existing = await queryRes.json();
    totalCount = existing.results?.length || 0;
    monthCount = existing.results?.filter(r => {
      const d = r.properties?.Fecha?.date?.start;
      return d && d >= monthStart;
    }).length || 0;
  } catch(e) {}

  // Determine churn risk
  let churnRisk = 'Activo';
  if (monthCount === 0 && totalCount > 3) churnRisk = 'En riesgo';
  if (monthCount === 0 && totalCount > 8) churnRisk = 'Inactivo';

  // Create check-in record
  await fetch(`https://api.notion.com/v1/pages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent: { database_id: CHECKINS_DB },
      properties: {
        'Nombre': { title: [{ text: { content: data.name || 'Miembro' } }] },
        'Fecha': { date: { start: dateStr } },
        'Customer ID': { rich_text: [{ text: { content: data.customer_id } }] },
        'Email': { email: data.email || null },
        'Plan': { select: { name: data.plan || 'familiar' } },
        'Check-ins este mes': { number: monthCount + 1 },
        'Check-ins total': { number: totalCount + 1 },
        'Riesgo churn': { select: { name: churnRisk } },
        'Miembro desde': { rich_text: [{ text: { content: data.since || '' } }] },
      }
    })
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://canica.fun');

  const { session, customer } = req.query;
  if (!session && !customer) {
    return res.status(400).json({ valid: false, error: 'Código inválido' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  try {
    let customerId = customer;

    if (session && !customer) {
      const sess = await stripe.checkout.sessions.retrieve(session);
      customerId = sess.customer;
    }

    if (!customerId) {
      return res.status(404).json({ valid: false, error: 'Cliente no encontrado' });
    }

    const cust = await stripe.customers.retrieve(customerId);
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });

    const hasActive = subs.data.length > 0;
    const sub = subs.data[0];

    const responseData = {
      valid: hasActive,
      customer_id: customerId,
      name: cust.name || cust.email || 'Miembro',
      email: cust.email,
      plan: sub ? sub.items.data[0]?.price?.nickname || 'familiar' : null,
      since: sub ? new Date(sub.start_date * 1000).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) : null,
      current_period_end: sub ? new Date(sub.current_period_end * 1000).toLocaleDateString('es-MX') : null,
    };

    // Log check-in to Notion (fire and forget — don't block the response)
    if (hasActive && req.query.log !== 'false') {
      logCheckin(responseData).catch(e => console.error('Log error:', e.message));
    }

    res.status(200).json(responseData);

  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ valid: false, error: err.message });
  }
};
