// api/checkin-stats.js — returns visit stats from Google Sheets
// GET ?days=30 → summary of visits

const { google } = require('googleapis');
const SHEET_ID = process.env.CHECKIN_SHEET_ID;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!SHEET_ID) {
    return res.status(200).json({ visits: [], total: 0, message: 'Sheet not configured yet' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Check-ins!A2:J',
    });

    const rows = result.data.values || [];
    const days = parseInt(req.query?.days || '30');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const visits = rows
      .map(r => ({
        timestamp: r[0], date: r[1], time: r[2], dow: r[3],
        type: r[4], name: r[5], customerId: r[6],
        email: r[7], people: parseInt(r[8]) || 1, notes: r[9]
      }))
      .filter(v => new Date(v.date) >= cutoff);

    // Aggregate stats
    const byDay = {};
    const byType = { member: 0, walkin: 0 };
    const uniqueNames = new Set();
    let totalPeople = 0;

    visits.forEach(v => {
      byDay[v.date] = (byDay[v.date] || 0) + 1;
      byType[v.type] = (byType[v.type] || 0) + 1;
      uniqueNames.add(v.name.toLowerCase());
      totalPeople += v.people;
    });

    res.status(200).json({
      total: visits.length,
      totalPeople,
      uniqueGuests: uniqueNames.size,
      members: byType.member,
      walkIns: byType.walkin,
      byDay,
      recentVisits: visits.slice(-20).reverse(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
