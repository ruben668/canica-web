// Cal.com webhook — fires on every new booking
// Sends WhatsApp notification to Saira via Telegram Bot (as SMS proxy)
// POST /api/cal-webhook

const BOT_TOKEN = '8580935482:AAFK-y4drZtUBaxNTL0cV6YseKiG0cyw3Os';
// Saira departed May 2026 — removed from notifications
// const SAIRA_WHATSAPP = '+525532909854';
const RUBEN_TELEGRAM  = '6525841557';
// const SAIRA_TELEGRAM  = '6247865657'; // Saira departed May 2026

async function sendTelegram(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  let event;
  try { event = JSON.parse(rawBody); } catch(e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const triggerEvent = event.triggerEvent || event.type;

  // Only process new bookings
  if (triggerEvent !== 'BOOKING_CREATED') {
    return res.status(200).json({ received: true, ignored: true });
  }

  const booking = event.payload || event;
  const attendee  = booking.attendees?.[0] || {};
  const fields    = booking.bookingFieldsResponses || booking.responses || {};
  const name      = attendee.name || fields.name || booking.title || 'Cliente';
  const email     = attendee.email || fields.email || '';
  const phone     = fields.phone || fields.whatsapp || fields.phoneNumber ||
                    attendee.phoneNumber || '';
  const startTime = booking.startTime ? new Date(booking.startTime).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit'
  }) : 'Fecha por confirmar';
  const eventType  = booking.eventType?.title || booking.title || 'Mesa';
  const responses  = booking.responses || {};
  const party      = responses.party_size?.value || responses.party?.value || responses.guests?.value || '';
  const partyNum   = parseInt(party) || 0;
  const children   = responses.children?.value || responses.ninos?.value || '';
  const notes      = responses.notes?.value || responses.additionalNotes?.value || '';

  // Build notification message
  const urgentFlag = partyNum >= 5 ? '⚠️ GRUPO GRANDE — confirmar por WhatsApp\n' : '';

  const msg = [
    `🍽 <b>Nueva reserva — ${eventType}</b>${partyNum >= 5 ? ' 👥 GRUPO DE '+partyNum : ''}`,
    urgentFlag || null,
    ``,
    `👤 <b>${name}</b>`,
    email ? `📧 ${email}` : null,
    phone ? `📱 ${phone}` : null,
    ``,
    `📅 <b>${startTime}</b>`,
    party ? `👥 ${party}` : null,
    children ? `🧒 Niños: ${children}` : null,
    notes ? `📝 ${notes}` : null,
    ``,
    `<i>Confirma respondiendo al cliente directamente.</i>`,
  ].filter(l => l !== null).join('\n');

  // Send to Ruben and Saira via Telegram
  await sendTelegram(RUBEN_TELEGRAM, msg);
  await sendTelegram(SAIRA_TELEGRAM, msg);

  // Also send WhatsApp link to Saira via Telegram
  // (We send via Telegram since Saira may not yet have the bot)
  // When Saira connects, we send directly to her
  const whatsappText = encodeURIComponent(
    `Hola! Nueva reserva en Canica:\n${name} — ${startTime}${party ? ` (${party})` : ''}${notes ? `\nNotas: ${notes}` : ''}`
  );

  console.log(`Booking received: ${name} — ${startTime}`);

  res.status(200).json({ received: true, booking: name });
};
