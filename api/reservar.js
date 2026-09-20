// api/reservar.js — Direct booking endpoint that bypasses Resos widget
// Uses Resos API to create reservations directly

const RESOS_KEY = process.env.RESOS_API_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RESOS_KEY) {
    return res.status(500).json({ error: 'Servidor mal configurado. Escríbenos por WhatsApp.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, phone, email, date, time, people, adults, kids, notes } = body || {};

    // Validation
    if (!name || !phone || !date || !time || !people) {
      return res.status(400).json({ error: 'Faltan datos. Nombre, teléfono, fecha, hora y personas son obligatorios.' });
    }

    const peopleNum = parseInt(people);
    if (isNaN(peopleNum) || peopleNum < 1 || peopleNum > 20) {
      return res.status(400).json({ error: 'Número de personas inválido.' });
    }

    // Validate date is today or future
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha inválido.' });
    }

    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(time)) {
      return res.status(400).json({ error: 'Formato de hora inválido.' });
    }

    // Build restaurant note with breakdown if provided
    const noteParts = [];
    if (adults) noteParts.push(`${adults} adultos`);
    if (kids) noteParts.push(`${kids} niños`);
    if (phone) noteParts.push(phone);
    if (notes) noteParts.push(notes.slice(0, 200));
    const restaurantNote = noteParts.join(' · ');

    const auth = 'Basic ' + Buffer.from(`${RESOS_KEY}:`).toString('base64');

    const bookingBody = {
      date,
      time,
      people: peopleNum,
      guest: {
        name: name.slice(0, 100),
        email: email || undefined,
        phone: phone
      },
      status: 'request', // Set as request so staff can approve/manage
      source: 'website',
      restaurantNotes: restaurantNote ? [{ restaurantNote }] : undefined
    };

    const r = await fetch('https://api.resos.com/v1/bookings', {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bookingBody)
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('Resos API error:', r.status, errText);
      return res.status(500).json({ error: 'No pudimos crear tu reserva. Escríbenos por WhatsApp al 55 3290 9854.' });
    }

    const bookingId = await r.json();

    // Notify staff via Telegram
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const RUBEN = '6525841557';
    if (TG_TOKEN) {
      try {
        const msg = `🍽 Nueva reserva vía canica.fun\n\n👤 ${name}\n📅 ${date} · ${time}\n👥 ${peopleNum} personas\n📞 ${phone}${email ? '\n📧 ' + email : ''}${notes ? '\n📝 ' + notes.slice(0, 100) : ''}`;
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: RUBEN, text: msg })
        });
      } catch (e) {
        console.error('Telegram notify failed:', e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      bookingId,
      message: '¡Reserva recibida! Te enviamos confirmación por WhatsApp.'
    });

  } catch (e) {
    console.error('Reservation error:', e);
    return res.status(500).json({ error: 'Error al procesar la reserva. Escríbenos por WhatsApp.' });
  }
};
