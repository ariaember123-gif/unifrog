const { put } = require('@vercel/blob');
const { formidable } = require('formidable');
const fs = require('fs');
const { sql, hashIp, getClientIp, checkRateLimit } = require('../lib/db');

// Vercel Node functions: disable the default body parser so formidable can read the raw stream.
module.exports.config = {
  api: { bodyParser: false },
};

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per image
const MAX_FILES = 10; // max images per upload request
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const NAME_MAX = 40;
const CAPTION_MAX = 280;

function parseForm(req) {
  const form = formidable({
    maxFiles: MAX_FILES,
    maxFileSize: MAX_FILE_BYTES,
    maxTotalFileSize: MAX_FILE_BYTES * MAX_FILES,
    multiples: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function clean(str, max) {
  if (!str) return '';
  return String(str).trim().slice(0, max).replace(/[<>]/g, '');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);

    const { fields, files } = await parseForm(req);

    // Honeypot field: real users never fill this in; bots often do.
    const honeypot = Array.isArray(fields.website) ? fields.website[0] : fields.website;
    if (honeypot) {
      return res.status(400).json({ error: 'Upload rejected.' });
    }

    const fileField = files.image;
    const fileList = !fileField ? [] : Array.isArray(fileField) ? fileField : [fileField];

    if (fileList.length === 0) {
      return res.status(400).json({ error: 'No image file uploaded (expected field name "image").' });
    }
    if (fileList.length > MAX_FILES) {
      return res.status(400).json({ error: `You can upload up to ${MAX_FILES} images at once.` });
    }

    // Validate the whole batch up front so we never partially upload a request.
    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList[i];
      const label = file.originalFilename ? `"${file.originalFilename}"` : `#${i + 1}`;
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return res.status(400).json({ error: `${label}: unsupported file type. Use PNG, JPG, GIF, or WEBP.` });
      }
      if (file.size > MAX_FILE_BYTES) {
        return res.status(400).json({ error: `${label}: file too large. Max size is 5MB per image.` });
      }
    }

    // Rate limit is checked against the batch size, so uploading 10 at once
    // still counts as 10 toward the daily cap instead of just 1.
    const rate = await checkRateLimit(ipHash, { maxPerDay: 15, cooldownSeconds: 20, weight: fileList.length });
    if (!rate.allowed) {
      return res.status(429).json({ error: rate.reason });
    }

    const uploaderRaw = Array.isArray(fields.uploader) ? fields.uploader[0] : fields.uploader;
    const captionRaw = Array.isArray(fields.caption) ? fields.caption[0] : fields.caption;
    const uploader = clean(uploaderRaw, NAME_MAX) || 'Anon Frog';
    const caption = clean(captionRaw, CAPTION_MAX);

    const memes = [];
    for (const file of fileList) {
      const buffer = fs.readFileSync(file.filepath);
      const ext = (file.originalFilename && file.originalFilename.split('.').pop()) || 'png';
      const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const key = `memes/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${safeExt}`;

      const blob = await put(key, buffer, {
        access: 'public',
        contentType: file.mimetype,
      });

      const { rows } = await sql`
        INSERT INTO memes (image_url, uploader, caption, ip_hash, status)
        VALUES (${blob.url}, ${uploader}, ${caption}, ${ipHash}, 'approved')
        RETURNING id, image_url, uploader, caption, likes, created_at
      `;
      memes.push(rows[0]);
    }

    return res.status(201).json({ memes });
  } catch (err) {
    console.error('Upload error:', err);
    const message = err && err.message && (err.message.includes('maxFileSize') || err.message.includes('maxTotalFileSize'))
      ? 'One or more files are too large. Max size is 5MB per image.'
      : 'Something went wrong uploading your memes. Please try again.';
    return res.status(500).json({ error: message });
  }
};
