// Stripe webhook — fires after successful subscription
// Sends check-in link to the member's email via Stripe's built-in receipt
// POST /api/webhook

module.exports = async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = webhookSecret
      ? stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
      : JSON.parse(rawBody.toString());
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerId = session.customer;
    const email = session.customer_details?.email;
    const plan = session.metadata?.plan || 'familiar';

    if (customerId && email) {
      const checkinUrl = `https://canica.fun/checkin.html?id=${customerId}`;

      // Update customer metadata with checkin URL
      await stripe.customers.update(customerId, {
        metadata: {
          checkin_url: checkinUrl,
          plan,
          joined: new Date().toISOString().slice(0, 10),
        }
      });

      console.log(`Member registered: ${email} → ${checkinUrl}`);
    }
  }

  res.status(200).json({ received: true });
};

// Parse raw body for Stripe signature verification
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(Buffer.from(data)));
    req.on('error', reject);
  });
}
