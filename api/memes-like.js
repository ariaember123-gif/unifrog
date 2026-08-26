const { sql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const id = parseInt((body && body.id) || (req.query && req.query.id), 10);

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'Missing or invalid meme id.' });
    }

    const { rows } = await sql`
      UPDATE memes SET likes = likes + 1
      WHERE id = ${id} AND status = 'approved'
      RETURNING id, likes
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Meme not found.' });
    }

    return res.status(200).json({ id: rows[0].id, likes: rows[0].likes });
  } catch (err) {
    console.error('Like error:', err);
    return res.status(500).json({ error: 'Could not register like.' });
  }
};
