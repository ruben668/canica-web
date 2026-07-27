// api/member-lookup.js
// POST { whatsapp, email? } → { isMember, name, tier, since, visitCount, customerId }
// Looks up active Stripe subscriptions by phone or email.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { whatsapp, email } = req.body || {};
  if (!whatsapp && !email) return res.status(400).json({ error: 'whatsapp or email required' });

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  try {
    // Normalize phone: strip non-digits, ensure country code
    const normalizePhone = (p) => {
      if (!p) return null;
      const digits = p.replace(/\D/g, '');
      // Mexican numbers: add 521 prefix if 10 digits
      if (digits.length === 10) return '521' + digits;
      if (digits.length === 12 && digits.startsWith('52')) return digits;
      return digits;
    };

    const phone = normalizePhone(whatsapp);
    let customer = null;

    // 1. Search by email first (more reliable)
    if (email) {
      const byEmail = await stripe.customers.list({ email: email.trim().toLowerCase(), limit: 3 });
      customer = byEmail.data.find(c => c.email);
    }

    // 2. Search by phone if no email match
    if (!customer && phone) {
      const byPhone = await stripe.customers.list({ limit: 100 });
      customer = byPhone.data.find(c => {
        const cPhone = normalizePhone(c.phone || c.metadata?.whatsapp || '');
        return cPhone && (cPhone === phone || cPhone.endsWith(phone.slice(-10)));
      });
    }

    if (!customer) {
      return res.status(200).json({ isMember: false });
    }

    // 3. Check for active subscription
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 3,
    });

    if (!subs.data.length) {
      return res.status(200).json({ isMember: false, customerId: customer.id, name: customer.name });
    }

    const sub = subs.data[0];
    const amount = (sub.items.data[0]?.price?.unit_amount || 0) / 100;
    const tier = amount >= 2400 ? 'Familia' : amount >= 1600 ? 'Familia' : 'Individual';
    const since = new Date(sub.start_date * 1000).toLocaleDateString('es-MX', {
      month: 'long', year: 'numeric', timeZone: 'America/Mexico_City'
    });

    return res.status(200).json({
      isMember: true,
      name: customer.name || '',
      email: customer.email || '',
      tier,
      amount,
      since,
      customerId: customer.id,
      subscriptionId: sub.id,
    });
  } catch (e) {
    console.error('member-lookup error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
