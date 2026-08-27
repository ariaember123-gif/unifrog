const { sql, hashIp, getClientIp } = require('../lib/db');

const NAME_MAX = 12;
const MAX_SCORE = 200000; // sanity cap — real runs can't realistically exceed this, blocks obvious spoofing
const TOP_N = 5;

function clean(str, max) {
  if (!str) return '';
  return String(str).trim().slice(0, max).replace(/[<>]/g, '');
}

async function getTop() {
  const { rows } = await sql`
    SELECT name, score, created_at
    FROM leaderboard
    ORDER BY score DESC, created_at ASC
    LIMIT ${TOP_N}
  `;
  return rows;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const entries = await getTop();
      return res.status(200).json({ entries });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const name = clean(body.name, NAME_MAX).toUpperCase() || 'FROG';
      const score = Math.floor(Number(body.score));

      if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) {
        return res.status(400).json({ error: 'Invalid score.' });
      }

      const ip = getClientIp(req);
      const ipHash = hashIp(ip);

      await sql`
        INSERT INTO leaderboard (name, score, ip_hash)
        VALUES (${name}, ${score}, ${ipHash})
      `;

      const entries = await getTop();
      return res.status(201).json({ entries });
    }

    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Could not process leaderboard request.' });
  }
};
