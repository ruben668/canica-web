// api/members-active.js — returns active Stripe subscriptions for staff view
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!STRIPE_KEY) {
    return res.status(500).json({ error: 'Stripe key not configured' });
  }

  try {
    const r = await fetch(
      'https://api.stripe.com/v1/subscriptions?status=active&limit=100&expand[]=data.customer',
      { headers: { 'Authorization': `Bearer ${STRIPE_KEY}` } }
    );
    const data = await r.json();

    const members = (data.data || []).map(s => {
      const cust = s.customer || {};
      const item = s.items?.data?.[0] || {};
      const price = item.price || {};
      const amount = (price.unit_amount || 0) / 100;
      const interval = price.recurring?.interval || 'month';

      // Next billing date
      const nextTs = s.current_period_end || s.billing_cycle_anchor;
      const nextBilling = nextTs
        ? new Date(nextTs * 1000).toLocaleDateString('es-MX', {
            day: 'numeric', month: 'short', year: 'numeric',
            timeZone: 'America/Mexico_City'
          })
        : '?';

      // Membership type by price
      let tier = amount >= 1600 ? 'Familia' : amount >= 900 ? 'Individual' : 'Miembro';

      return {
        name: cust.name || cust.email || cust.id || '?',
        email: cust.email || '',
        amount,
        interval,
        tier,
        nextBilling,
        customerId: cust.id || '',
      };
    });

    // Sort by name
    members.sort((a, b) => a.name.localeCompare(b.name));

    const mrr = members.reduce((s, m) => s + m.amount, 0);
    res.status(200).json({ members, count: members.length, mrr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
