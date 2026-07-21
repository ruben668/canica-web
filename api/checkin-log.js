// api/checkin-log.js — logs member check-ins and walk-ins
// POST { type: 'member'|'walkin', name, customerId?, email?, notes? }
// Appends to a rolling log; also writes to Google Sheets when available.

const { google } = require('googleapis');
const SHEET_ID = process.env.CHECKIN_SHEET_ID; // set once sheet is created

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, name, customerId, email, notes, people } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'type and name required' });

  const now = new Date();
  const cdmx = now.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'short', timeStyle: 'short'
  });
  const dateOnly = now.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const timeOnly = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
  const dow = now.toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'America/Mexico_City' });

  const entry = {
    timestamp: cdmx,
    date: dateOnly,
    time: timeOnly,
    dow,
    type,           // 'member' | 'walkin'
    name,
    customerId: customerId || '',
    email: email || '',
    people: people || 1,
    notes: notes || '',
  };

  // Write to Google Sheets if configured
  let sheetOk = false;
  if (SHEET_ID) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Check-ins!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            entry.timestamp, entry.date, entry.time, entry.dow,
            entry.type, entry.name, entry.customerId,
            entry.email, entry.people, entry.notes
          ]]
        }
      });
      sheetOk = true;
    } catch (e) {
      console.error('Sheets error:', e.message);
    }
  }

  res.status(200).json({ ok: true, entry, sheetOk });
};
