// Vercel serverless function — creates Stripe Checkout session
// POST /api/checkout { plan: "basica" | "familiar" | "club" }

const PRICE_IDS = {
  primer_nino:   "price_1TTYtpAoX74kIgZkjZk78Usl",
  segundo_nino:  "price_1TTYtqAoX74kIgZkpBp5GGkW",
  tercer_nino:   "price_1TTYtrAoX74kIgZkF150YyNU",
  tope_familiar: "price_1TTYtsAoX74kIgZkltKYdF99",
  // Legacy aliases
  dos_ninos: "price_1TTZ6CAoX74kIgZkTJNS3tu8",
  basica:   "price_1TTYtpAoX74kIgZkjZk78Usl",
  familiar: "price_1TTYtsAoX74kIgZkltKYdF99",
};

const PLAN_NAMES = {
  primer_nino:   "Canica Commons — Primer niño $950/mes",
  segundo_nino:  "Canica Commons — Segundo niño $700/mes",
  tercer_nino:   "Canica Commons — Tercer niño $600/mes",
  tope_familiar: "Canica Commons — Tópe familiar $2,500/mes",
  dos_ninos:     "Canica Commons — Dos niños $1,650/mes",
  basica:        "Canica Commons — Primer niño $950/mes",
  familiar:      "Canica Commons — Tópe familiar $2,500/mes",
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan } = req.body || {};
  const priceId = PRICE_IDS[plan];

  if (!priceId) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.origin || "https://canica.fun";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/success.html?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#membership`,
      locale: "es",
      metadata: { plan, plan_name: PLAN_NAMES[plan] },
      subscription_data: {
        metadata: { plan, source: "canica.fun" }
      },
      custom_text: {
        submit: { message: "Cargo mensual automático. Cancela cuando quieras. Guarda el QR que aparece al finalizar — es tu pase de entrada." },
        after_submit: { message: "Revisa tu correo. Te enviaremos tu pase de entrada y los detalles de tu membresía." }
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
