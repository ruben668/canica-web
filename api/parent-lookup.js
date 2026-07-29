// api/parent-lookup.js
// POST { whatsapp } → { known, name, kidName, email, isMember, ... }
// Checks Stripe for membership + a simple KV store for returning parents

// Simple in-memory parent store (persists within Vercel function warm instances)
// When Sheets is connected, this falls back to Sheets lookup
const parentCache = new Map();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { whatsapp, action, data } = req.body || {};

  if (!whatsapp) return res.status(400).json({ error: 'whatsapp required' });

  // Normalize phone
  const digits = whatsapp.replace(/\D/g, '');
  const normalized = digits.length === 10 ? '52' + digits : digits;
  const key = normalized.slice(-10); // last 10 digits as key

  // SAVE: when a new parent registers, save their profile
  if (action === 'save' && data) {
    parentCache.set(key, {
      name: data.name,
      kidName: data.kidName,
      kidDOB: data.kidDOB,
      email: data.email,
      source: data.source,
      whatsapp: normalized,
      firstSeen: new Date().toISOString(),
    });
    return res.status(200).json({ ok: true });
  }

  // LOOKUP: check if parent is known
  const cached = parentCache.get(key);

  // Also check Stripe for membership
  let memberData = { isMember: false };
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const customers = await stripe.customers.list({ limit: 100 });
    const customer = customers.data.find(c => {
      const cDigits = (c.phone || c.metadata?.whatsapp || '').replace(/\D/g, '');
      return cDigits && cDigits.slice(-10) === key;
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

  if (cached || memberData.isMember) {
    return res.status(200).json({
      known: true,
      name: memberData.name || cached?.name || '',
      kidName: cached?.kidName || '',
      email: cached?.email || memberData.email || '',
      whatsapp: normalized,
      ...memberData,
    });
  }

  return res.status(200).json({ known: false });
};
