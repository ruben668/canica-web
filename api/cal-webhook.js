// Cal.com webhook — fires on every new booking
// Sends Telegram notification to Ruben
// POST /api/cal-webhook

const BOT_TOKEN    = '8580935482:AAFK-y4drZtUBaxNTL0cV6YseKiG0cyw3Os';
const RUBEN        = '6525841557';

// Deduplicate: track recent booking UIDs to avoid duplicate notifications
const recentUIDs = new Set();

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
    return res.status(200).json({ received: true, ignored: triggerEvent });
  }

  const booking = event.payload || event;

  // Deduplicate by booking UID — Cal.com sometimes fires the webhook multiple times
  const uid = booking.uid || booking.id || booking.bookingId;
  if (uid && recentUIDs.has(uid)) {
    console.log(`Duplicate webhook for booking ${uid} — ignored`);
    return res.status(200).json({ received: true, duplicate: true });
  }
  if (uid) {
    recentUIDs.add(uid);
    // Clean up after 5 minutes
    setTimeout(() => recentUIDs.delete(uid), 5 * 60 * 1000);
  }

  // Extract fields
  const attendee = booking.attendees?.[0] || {};
  const fields   = booking.bookingFieldsResponses || booking.responses || {};

  const name  = attendee.name || fields.name || 'Cliente';
  const email = attendee.email || fields.email || '';

  // Phone: try multiple field names Cal.com uses
  const phone = fields.phone?.value || fields.phone ||
                fields.whatsapp?.value || fields.whatsapp ||
                fields.phoneNumber?.value || fields.phoneNumber ||
                attendee.phoneNumber || '';

  // Party size: Cal.com stores custom fields under their label slug
  const partyRaw = fields.party_size?.value || fields.party_size ||
                   fields.party?.value || fields.party ||
                   fields.guests?.value || fields.guests ||
                   fields.personas?.value || fields.personas ||
                   fields.cuantas_personas?.value || fields.cuantas_personas || '';
  const partyNum = parseInt(partyRaw) || 0;

  // Children
  const children = fields.children?.value || fields.children ||
                   fields.ninos?.value || fields.ninos ||
                   fields.ninios?.value || fields.ninios || '';

  // Notes / special requests
  const notes = fields.notes?.value || fields.notes ||
                fields.additionalNotes?.value || fields.additionalNotes ||
                fields.notas?.value || fields.notas ||
                booking.description || '';

  const startTime = booking.startTime
    ? new Date(booking.startTime).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit'
      })
    : 'Fecha por confirmar';

  const isLargeGroup = partyNum >= 5;

  const lines = [
    isLargeGroup
      ? `⚠️ <b>GRUPO GRANDE — Reserva Nueva</b>`
      : `🍽 <b>Nueva reserva</b>`,
    ``,
    `👤 <b>${name}</b>`,
    email   ? `📧 ${email}`       : null,
    phone   ? `📱 ${phone}`       : null,
    ``,
    `📅 <b>${startTime}</b>`,
    partyNum > 0 ? `👥 ${partyNum} persona${partyNum > 1 ? 's' : ''}` : null,
    children    ? `🧒 Niños: ${children}` : null,
    notes       ? `📝 ${notes}`          : null,
    ``,
    isLargeGroup
      ? `⚠️ <b>Confirmar mesa grande por WhatsApp o llamada.</b>`
      : `<i>Confirma respondiendo al cliente directamente.</i>`,
  ].filter(l => l !== null).join('\n');

  await sendTelegram(RUBEN, lines);

  console.log(`Booking: ${name} — ${startTime} — party: ${partyNum} — uid: ${uid}`);
  res.status(200).json({ received: true, booking: name });
};
