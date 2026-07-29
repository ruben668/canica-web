// api/parent-lookup.js
// POST { whatsapp } → { known, name, kidName, email, isMember, ... }
// Queries Notion Check-ins DB for returning parents + Stripe for membership

const NOTION_KEY = process.env.NOTION_API_KEY;
const NOTION_DB  = process.env.NOTION_CHECKINS_DB;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { whatsapp, action, data } = req.body || {};
  if (!whatsapp) return res.status(400).json({ error: 'whatsapp required' });

  const digits = whatsapp.replace(/\D/g, '');
  const normalized = digits.length === 10 ? '521' + digits : digits;
  const last10 = digits.slice(-10);

  // SAVE action — handled by checkin-log now, just acknowledge
  if (action === 'save') {
    return res.status(200).json({ ok: true });
  }

  // Check Stripe for membership first (most authoritative)
  let memberData = { isMember: false };
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const customers = await stripe.customers.list({ limit: 100 });
    const customer = customers.data.find(c => {
      const cDigits = (c.phone || c.metadata?.whatsapp || '').replace(/\D/g, '');
      return cDigits && cDigits.slice(-10) === last10;
    });
    if (customer) {
      const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
      if (subs.data.length) {
        const sub = subs.data[0];
        const amount = (sub.items.data[0]?.price?.unit_amount || 0) / 100;
        const tier = amount >= 2400 ? 'Familia' : amount >= 1600 ? 'Familia' : 'Individual';
        const since = new Date(sub.start_date * 1000).toLocaleDateString('es-MX', {
          month: 'long', year: 'numeric', timeZone: 'America/Mexico_City'
        });
        memberData = { isMember: true, tier, since, customerId: customer.id, name: customer.name, email: customer.email };
      }
    }
  } catch (e) {
    console.error('Stripe lookup error:', e.message);
  }

  // Check Notion for returning parent profile
  let notionProfile = null;
  if (NOTION_KEY && NOTION_DB) {
    try {
      const notionRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            property: 'WhatsApp',
            phone_number: { equals: last10 },
          },
          sorts: [{ property: 'Fecha', direction: 'descending' }],
          page_size: 100, // get all visits for count
        }),
      });
      const notionData = await notionRes.json();
      const rows = notionData.results || [];
      if (rows.length > 0) {
        const row = rows[0].properties;
        notionProfile = {
          name: row['Nombre']?.title?.[0]?.plain_text || '',
          kids: row['Niños']?.rich_text?.[0]?.plain_text || '',
          email: row['Email']?.email || '',
          visitCount: rows.length, // total past visits
        };
      }
    } catch (e) {
      console.error('Notion lookup error:', e.message);
    }
  }

  // Also try phone number variants (with/without country code)
  if (!notionProfile && NOTION_KEY && NOTION_DB) {
    try {
      const variants = [normalized, '+' + normalized, last10, '52' + last10, '+52' + last10];
      for (const v of variants) {
        const notionRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NOTION_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: { property: 'WhatsApp', phone_number: { equals: v } },
            page_size: 1,
          }),
        });
        const nd = await notionRes.json();
        if (nd.results?.length > 0) {
          const row = nd.results[0].properties;
          notionProfile = {
            name: row['Nombre']?.title?.[0]?.plain_text || '',
            kids: row['Niños']?.rich_text?.[0]?.plain_text || '',
            email: row['Email']?.email || '',
          };
          break;
        }
      }
    } catch (e) {}
  }

  if (memberData.isMember || notionProfile) {
    return res.status(200).json({
      known: true,
      name: memberData.name || notionProfile?.name || '',
      email: memberData.email || notionProfile?.email || '',
      kids: notionProfile?.kids || '',
      visitCount: (notionProfile?.visitCount || 0) + 1, // +1 for current visit
      whatsapp: normalized,
      ...memberData,
    });
  }

  return res.status(200).json({ known: false });
};
