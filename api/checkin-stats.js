// api/checkin-stats.js — reads check-ins from Notion and returns aggregate stats
// GET → { totalCheckins, uniqueParents, uniqueKids, members, walkIns, parents, kids }

const NOTION_KEY = process.env.NOTION_KEY || process.env.NOTION_API_KEY;
const NOTION_DB  = process.env.NOTION_CHECKINS_DB;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!NOTION_KEY || !NOTION_DB) {
    return res.status(500).json({ error: 'Notion not configured', hasKey: !!NOTION_KEY, hasDb: !!NOTION_DB });
  }

  try {
    // Paginate through the entire DB
    const all = [];
    let cursor = undefined;
    for (let i = 0; i < 20; i++) {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.object === 'error') return res.status(500).json({ error: data.message, code: data.code });
      all.push(...(data.results || []));
      if (!data.has_more) break;
      cursor = data.next_cursor;
    }

    const rows = all.map(page => {
      const p = page.properties || {};
      const getTitle = f => (p[f]?.title || []).map(t => t.plain_text).join('');
      const getRich = f => (p[f]?.rich_text || []).map(t => t.plain_text).join('');
      const getSelect = f => p[f]?.select?.name || '';
      const getDate = f => p[f]?.date?.start || '';
      const getPhone = f => p[f]?.phone_number || '';
      const getEmail = f => p[f]?.email || '';
      const getCheck = f => !!p[f]?.checkbox;
      return {
        name: getTitle('Nombre'),
        type: getSelect('Tipo'),
        date: getDate('Fecha'),
        time: getRich('Hora'),
        kids: getRich('Niños'),
        phone: getPhone('WhatsApp'),
        email: getEmail('Email'),
        neighborhood: getSelect('Colonia'),
        source: getSelect('Fuente'),
        firstVisit: getCheck('Primera visita'),
      };
    });

    // Aggregate by parent (phone > name)
    const byParent = new Map();
    for (const row of rows) {
      const key = row.phone || row.name.toLowerCase().trim();
      if (!byParent.has(key)) {
        byParent.set(key, {
          parentName: row.name,
          phone: row.phone,
          email: row.email,
          neighborhood: row.neighborhood,
          source: row.source,
          type: row.type,
          kids: new Set(),
          visitCount: 0,
          firstVisit: row.date,
          lastVisit: row.date,
        });
      }
      const p = byParent.get(key);
      p.visitCount++;
      if (row.kids) row.kids.split(',').map(k => k.trim()).forEach(k => p.kids.add(k));
      if (row.date && row.date < p.firstVisit) p.firstVisit = row.date;
      if (row.date && row.date > p.lastVisit) p.lastVisit = row.date;
    }

    // Aggregate by individual kid (name + parent phone as key)
    const kidStats = new Map();
    for (const row of rows) {
      if (!row.kids) continue;
      const kidNames = row.kids.split(',').map(k => k.trim().replace(/\s*\([^)]*\)$/, '')).filter(Boolean);
      for (const kn of kidNames) {
        // Key by kid name + parent phone (so we don't merge different Nicolás)
        const k = kn.toLowerCase() + '|' + (row.phone || row.name);
        if (!kidStats.has(k)) {
          kidStats.set(k, { name: kn, parent: row.name, parentPhone: row.phone, visitCount: 0, firstVisit: row.date, lastVisit: row.date });
        }
        const s = kidStats.get(k);
        s.visitCount++;
        if (row.date && row.date < s.firstVisit) s.firstVisit = row.date;
        if (row.date && row.date > s.lastVisit) s.lastVisit = row.date;
      }
    }

    const parents = [...byParent.values()].map(p => ({
      ...p,
      kids: [...p.kids],
    })).sort((a, b) => b.visitCount - a.visitCount);

    const kids = [...kidStats.values()].sort((a, b) => b.visitCount - a.visitCount);

    // By date
    const byDate = {};
    for (const row of rows) {
      if (!row.date) continue;
      byDate[row.date] = (byDate[row.date] || 0) + 1;
    }

    // Backwards-compat mode: ?days=N returns recent-visits shape used by host.html
    const daysParam = parseInt((req.query && req.query.days) || '0');
    if (daysParam > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysParam);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const recent = rows
        .filter(r => r.date && r.date >= cutoffStr)
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
        .slice(0, 50)
        .map(r => ({
          name: r.name,
          time: r.time,
          date: r.date,
          type: r.type === 'Miembro' ? 'member' : 'walkin',
          people: (r.kids ? r.kids.split(',').length : 1),
          notes: r.kids,
          phone: r.phone,
        }));
      const totalPeople = recent.reduce((s, r) => s + (r.people || 1), 0);
      const membersCount = recent.filter(r => r.type === 'member').length;
      return res.status(200).json({
        total: recent.length,
        totalPeople,
        members: membersCount,
        walkIns: recent.length - membersCount,
        recentVisits: recent,
        byDay: byDate,
      });
    }

    res.status(200).json({
      totalCheckins: rows.length,
      uniqueParents: parents.length,
      uniqueKids: kids.length,
      members: rows.filter(r => r.type === 'Miembro').length,
      walkIns: rows.filter(r => r.type === 'Walk-in').length,
      parents,
      kids,
      byDate,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
