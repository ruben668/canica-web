// api/checkin-log.js — logs check-ins to Notion database
// POST { type, name, phone, customerId?, email?, kidName, kidDOB, kids?, neighborhood?, source?, notes? }

const NOTION_KEY = process.env.NOTION_API_KEY;
const NOTION_DB  = process.env.NOTION_CHECKINS_DB;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, name, phone, customerId, email, kidName, kidDOB, kids, neighborhood, source, notes } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'type and name required' });

  const now = new Date();
  const cdmx = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const dateStr = cdmx.toLocaleDateString('en-CA');
  const timeStr = cdmx.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  // Build kids string
  const kidsArr = kids && kids.length > 0 ? kids : (kidName ? [{ name: kidName, dob: kidDOB || '' }] : []);
  const kidsStr = kidsArr.map(k => k.name + (k.dob ? ' (' + k.dob + ')' : '')).join(', ');

  // Normalize neighborhood/source for Notion select
  const neighborhoodMap = {
    'condesa': 'Condesa', 'roma-norte': 'Roma Norte', 'roma-sur': 'Roma Sur',
    'polanco': 'Polanco', 'lomas': 'Lomas', 'santa-fe': 'Santa Fe',
    'napoles': 'Nápoles / Del Valle', 'coyoacan': 'Coyoacán',
    'interlomas': 'Interlomas', 'satelite': 'Satélite',
    'otra-cdmx': 'Otra CDMX', 'otra-estado': 'Otro estado',
  };
  const sourceMap = {
    'instagram': 'Instagram', 'google': 'Google / Maps',
    'recomendacion': 'Recomendación', 'pase': 'Pasé y entré',
    'ya-conocia': 'Ya conocía Canica',
  };

  const notionNeighborhood = neighborhoodMap[neighborhood] || neighborhood || null;
  const notionSource = sourceMap[source] || source || null;
  const membershipTier = req.body.tier || null;

  const entry = {
    timestamp: cdmx.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
    date: dateStr, time: timeStr, type, name,
    phone: phone || '', email: email || '',
    kids: kidsStr, neighborhood: notionNeighborhood,
    source: notionSource, notes: notes || '',
  };

  // Write to Notion
  let notionOk = false;
  if (NOTION_KEY && NOTION_DB) {
    try {
      const properties = {
        'Nombre': { title: [{ text: { content: name } }] },
        'Tipo': { select: { name: type === 'member' ? 'Miembro' : 'Walk-in' } },
        'Fecha': { date: { start: dateStr } },
        'Hora': { rich_text: [{ text: { content: timeStr } }] },
        'Niños': { rich_text: [{ text: { content: kidsStr } }] },
        'Primera visita': { checkbox: req.body.firstVisit === true },
        'Notas': { rich_text: [{ text: { content: (notes || '').slice(0, 2000) } }] },
      };

      if (phone) properties['WhatsApp'] = { phone_number: phone };
      if (email) properties['Email'] = { email: email };
      if (notionNeighborhood) properties['Colonia'] = { select: { name: notionNeighborhood } };
      if (notionSource) properties['Fuente'] = { select: { name: notionSource } };
      if (membershipTier) properties['Membresía'] = { select: { name: membershipTier } };

      const notionRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: NOTION_DB },
          properties,
        }),
      });
      const notionData = await notionRes.json();
      notionOk = !!notionData.id;
      if (!notionOk) console.error('Notion error:', JSON.stringify(notionData).slice(0, 200));
    } catch (e) {
      console.error('Notion write error:', e.message);
    }
  }

  res.status(200).json({ ok: true, entry, notionOk });
};
