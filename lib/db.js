const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

/**
 * Hash an IP address so we never store raw IPs, just enough to rate-limit / moderate.
 */
function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || 'unifrog-pond-salt';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex');
}

/**
 * Best-effort extraction of the caller's IP behind Vercel's proxy.
 */
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

/**
 * Very small rate limiter: max N uploads per IP per day, and a cooldown between uploads.
 * Returns { allowed: boolean, reason?: string }
 */
async function checkRateLimit(ipHash, { maxPerDay = 10, cooldownSeconds = 30, weight = 1 } = {}) {
  const { rows } = await sql`
    SELECT last_upload, count_today, day_marker
    FROM upload_limits WHERE ip_hash = ${ipHash}
  `;

  const now = new Date();

  if (rows.length === 0) {
    if (weight > maxPerDay) {
      return { allowed: false, reason: `You can upload up to ${maxPerDay} memes per day.` };
    }
    await sql`
      INSERT INTO upload_limits (ip_hash, last_upload, count_today, day_marker)
      VALUES (${ipHash}, ${now.toISOString()}, ${weight}, CURRENT_DATE)
    `;
    return { allowed: true };
  }

  const row = rows[0];
  const lastUpload = new Date(row.last_upload);
  const secondsSinceLast = (now - lastUpload) / 1000;

  if (secondsSinceLast < cooldownSeconds) {
    return { allowed: false, reason: `Please wait ${Math.ceil(cooldownSeconds - secondsSinceLast)}s before uploading again.` };
  }

  const isNewDay = new Date(row.day_marker).toDateString() !== now.toDateString();
  const countSoFar = isNewDay ? 0 : row.count_today;
  const nextCount = countSoFar + weight;

  if (nextCount > maxPerDay) {
    return { allowed: false, reason: `Daily upload limit reached (${maxPerDay}/day). Try again tomorrow.` };
  }

  await sql`
    UPDATE upload_limits
    SET last_upload = ${now.toISOString()},
        count_today = ${nextCount},
        day_marker = CURRENT_DATE
    WHERE ip_hash = ${ipHash}
  `;

  return { allowed: true };
}

module.exports = { sql, hashIp, getClientIp, checkRateLimit };
