// api/host-data.js — serves today's reservations to the host view
// Combines Resos + Cal.com, deduplicates, returns clean JSON

const RESOS_KEY = process.env.RESOS_API_KEY;
const CAL_KEY   = process.env.CAL_API_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Support ?date=YYYY-MM-DD for browsing past/future days
  let qDate = null;
  try {
    qDate = req.query?.date || new URL(req.url, 'https://x.com').searchParams.get('date');
  } catch(e) {}
  const today = (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate))
    ? qDate
    : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const reservations = [];

  // Fetch Resos
  if (RESOS_KEY) {
    try {
      const auth = 'Basic ' + Buffer.from(`${RESOS_KEY}:`).toString('base64');
      const r = await fetch('https://api.resos.com/v1/bookings?limit=500', {
        headers: { 'Authorization': auth, 'Accept': 'application/json' }
      });
      const bookings = await r.json();
      if (Array.isArray(bookings)) {
        bookings.forEach(b => {
          const dt = b.dateTime || b.date || '';
          if (!dt.includes(today)) return;
          const cdmx = new Date(new Date(dt).toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
          const h12 = cdmx.getHours() > 12 ? cdmx.getHours()-12 : cdmx.getHours();
          const ampm = cdmx.getHours() >= 12 ? 'PM' : 'AM';
          const timeStr = `${h12}:${String(cdmx.getMinutes()).padStart(2,'0')} ${ampm}`;
          reservations.push({
            dateTime: dt,
            timeStr,
            guestName: b.guest?.name || b.customer?.name || '?',
            people: b.people || 0,
            phone: b.phone || '',
            note: b.note || '',
            source: 'resos',
          });
        });
      }
    } catch(e) {
      console.error('Resos error:', e.message);
    }
  }

  // Fetch Cal.com
  if (CAL_KEY) {
    try {
      const r = await fetch('https://api.cal.com/v2/bookings?status=upcoming&limit=50', {
        headers: { 'Authorization': `Bearer ${CAL_KEY}`, 'cal-api-version': '2024-08-13' }
      });
      const data = await r.json();
      (data.data || []).forEach(b => {
        if (!b.start?.includes(today)) return;
        const cdmx = new Date(new Date(b.start).toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        const h12 = cdmx.getHours() > 12 ? cdmx.getHours()-12 : cdmx.getHours();
        const ampm = cdmx.getHours() >= 12 ? 'PM' : 'AM';
        const timeStr = `${h12}:${String(cdmx.getMinutes()).padStart(2,'0')} ${ampm}`;
        const att = b.attendees?.[0] || {};
        const name = att.name || '?';
        const fields = b.bookingFieldsResponses || {};
        const adults = parseInt(fields['Cuantos-Adultos'] || '0');
        const kids = parseInt(fields['Cuantos-Ni-os'] || '0');
        const people = adults + kids || 1;
        const phone = att.phoneNumber || '';
        
        // Deduplicate against Resos by first name + hour
        const firstNameHour = `${name.toLowerCase().split(' ')[0]}-${cdmx.getHours()}`;
        const alreadyInResos = reservations.some(r => 
          `${r.guestName.toLowerCase().split(' ')[0]}-${new Date(r.dateTime).getUTCHours()}` === firstNameHour
        );
        if (!alreadyInResos) {
          reservations.push({
            dateTime: b.start,
            timeStr,
            guestName: name,
            people,
            phone,
            note: b.description || '',
            source: 'calcom',
          });
        }
      });
    } catch(e) {
      console.error('Cal.com error:', e.message);
    }
  }

  // Add manual reservations (large groups, special cases)
  try {
    const fs = require('fs');
    const path = require('path');
    const manualPath = path.join(__dirname, '../data/manual-reservations.json');
    if (fs.existsSync(manualPath)) {
      const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
      manual.forEach(m => {
        if (m.dateTime && m.dateTime.includes(today)) {
          reservations.push(m);
        }
      });
    }
  } catch(e) {
    console.error('Manual reservations error:', e.message);
  }

  // Sort by time
  reservations.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

  res.status(200).json({ reservations, count: reservations.length, date: today });
};
