const { sql } = require('../lib/db');

const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX = 60;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    const { sort = 'new', page = '1', pageSize = String(PAGE_SIZE_DEFAULT) } = req.query || {};

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(pageSize, 10) || PAGE_SIZE_DEFAULT));
    const offset = (pageNum - 1) * size;

    // sort is whitelisted to exactly two known values, so it's safe to branch
    // into two literal queries rather than trying to parametrize an ORDER BY clause
    // (Postgres can't bind identifiers/keywords as query parameters).
    const { rows } = sort === 'top'
      ? await sql`
          SELECT id, image_url, uploader, caption, likes, created_at
          FROM memes
          WHERE status = 'approved'
          ORDER BY likes DESC, created_at DESC
          LIMIT ${size} OFFSET ${offset}
        `
      : await sql`
          SELECT id, image_url, uploader, caption, likes, created_at
          FROM memes
          WHERE status = 'approved'
          ORDER BY created_at DESC
          LIMIT ${size} OFFSET ${offset}
        `;

    const { rows: countRows } = await sql`
      SELECT COUNT(*)::int AS total FROM memes WHERE status = 'approved'
    `;

    return res.status(200).json({
      memes: rows,
      page: pageNum,
      pageSize: size,
      total: countRows[0].total,
      hasMore: offset + rows.length < countRows[0].total,
    });
  } catch (err) {
    console.error('List error:', err);
    return res.status(500).json({ error: 'Could not load the meme gallery right now.' });
  }
};
