// member-verify.js — GET /api/member-verify?id=cus_xxx
// Clean, public endpoint for QR code scanning
// Returns JSON: { valid, name, status, message }

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { id } = req.query;
  if (!id) return res.status(400).json({ valid: false, message: 'Código inválido' });

  try {
    const stripe = require('stripe')(STRIPE_SECRET);

    // Get customer
    let customer;
    try {
      customer = await stripe.customers.retrieve(id);
    } catch(e) {
      return res.status(200).json({ valid: false, message: 'Membresía no encontrada' });
    }

    if (customer.deleted) {
      return res.status(200).json({ valid: false, message: 'Membresía cancelada' });
    }

    // Get active subscriptions
    const subs = await stripe.subscriptions.list({
      customer: id,
      status: 'active',
      limit: 1,
    });

    if (subs.data.length === 0) {
      // Check for past_due
      const pastDue = await stripe.subscriptions.list({
        customer: id,
        status: 'past_due',
        limit: 1,
      });
      if (pastDue.data.length > 0) {
        return res.status(200).json({
          valid: false,
          name: customer.name || 'Miembro',
          message: 'Membresía con pago pendiente — contactar a Emma',
        });
      }
      return res.status(200).json({
        valid: false,
        name: customer.name || 'Miembro',
        message: 'Membresía no activa',
      });
    }

    const sub = subs.data[0];
    const anchor = new Date(sub.billing_cycle_anchor * 1000);
    // Next renewal is anchor + N months (approximate)
    const nextRenewal = new Date(anchor);
    while (nextRenewal < new Date()) {
      nextRenewal.setMonth(nextRenewal.getMonth() + 1);
    }
    const renewalStr = nextRenewal.toLocaleDateString('es-MX', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City'
    });

    return res.status(200).json({
      valid: true,
      name: customer.name || 'Miembro',
      message: `Membresía activa · Renueva ${renewalStr}`,
      customer_id: id,
    });

  } catch(e) {
    console.error('member-verify error:', e.message);
    return res.status(500).json({ valid: false, message: 'Error al verificar — intenta de nuevo' });
  }
};
