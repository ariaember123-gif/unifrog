# UniFrog Meme Gallery — Backend

This adds a real backend to the meme gallery so anyone can upload a meme and everyone
else sees it too (right now the site is 100% static HTML, so nothing persists or is
shared between visitors).

Stack, chosen to fit your existing setup (static site on Vercel, no framework):
- **Vercel Serverless Functions** (`/api/*.js`) — the actual backend endpoints
- **Vercel Blob** — stores the uploaded meme images
- **Vercel Postgres** — stores meme metadata (uploader, caption, likes, timestamps)

You do **not** need to rewrite your site as a Next.js app. Any files placed in an
`/api` folder at your project root are automatically deployed as serverless functions
by Vercel, alongside your existing static `index.html` / `game.html`.

## 1. Copy files into your repo

```
your-repo/
├── index.html
├── game.html
├── assets/
├── api/                     <-- new
│   ├── memes.js
│   ├── memes-upload.js
│   └── memes-like.js
├── lib/                     <-- new
│   └── db.js
└── package.json             <-- new (or merge deps into an existing one)
```

Copy this project's `api/`, `lib/`, `package.json`, and `sql/` folders straight into
the root of your `unifrog` repo.

## 2. Add Storage in the Vercel dashboard

In your Vercel project (`unifrog-blond`):

1. **Storage → Create Database → Postgres.** Name it anything (e.g. `unifrog-db`).
   Vercel automatically adds `POSTGRES_URL` etc. to your project's environment variables.
2. **Storage → Create → Blob.** Name it anything (e.g. `unifrog-memes`).
   Vercel automatically adds `BLOB_READ_WRITE_TOKEN` to your project's environment variables.
3. Add one more env var yourself: **`IP_HASH_SALT`** — any random string, used only to
   anonymize uploader IPs for basic rate-limiting (never stored raw).

## 3. Create the database table

In the Vercel dashboard: **Storage → your Postgres DB → Query** tab, paste the
contents of `sql/schema.sql` and run it once. That creates the `memes` and
`upload_limits` tables.

## 4. Install dependencies

```bash
npm install
# or merge these into your existing package.json:
#   @vercel/blob, @vercel/postgres, formidable
```

## 5. Wire up the frontend

1. Copy `public-snippets/meme-gallery.js` into your repo, e.g. as `assets/meme-gallery.js`.
2. Paste the CSS from `public-snippets/memes-section.css` into the `<style>` block
   in `index.html` (it reuses your existing `--pink`, `--green-deep`, `--cream`, etc.
   variables, so it matches the rest of the site automatically).
3. Paste the HTML from `public-snippets/memes-section.html` into `index.html`,
   inside `<main>` — a good spot is right before `<section class="community">`.
4. Right before `</body>` in `index.html`, add:
   ```html
   <script src="assets/meme-gallery.js"></script>
   ```
5. `game.html`'s nav already links to `index.html#memes` — once the section exists
   with `id="memes"`, that link will work.

## 6. Deploy

```bash
git add .
git commit -m "Add meme gallery backend"
git push
```

Vercel will redeploy automatically. Visit `your-site.vercel.app/#memes`, upload a
test image, and confirm it shows up in the grid.

## What you get

- `GET /api/memes?sort=new|top&page=1&pageSize=24` — paginated list of approved memes
- `POST /api/memes-upload` — multipart form (`image` file, optional `uploader`, `caption`)
  → stores the image in Blob, writes a row to Postgres, returns the new meme
- `POST /api/memes-like` — `{ "id": 123 }` → increments that meme's like count

Built-in safeguards (so this doesn't turn into an open image dump):
- File type allow-list (PNG/JPG/GIF/WEBP) and 5MB size cap
- Per-IP rate limiting (default: 15 uploads/day, 20s cooldown between uploads) —
  tune the numbers in `api/memes-upload.js`
- A hidden honeypot field that silently rejects most bot submissions
- Uploader name/caption are length-capped and stripped of `<`/`>` to avoid HTML injection
  (the frontend also escapes everything before inserting it into the page)
- A `status` column (`approved` / `pending` / `rejected`) on every meme — the API only
  ever serves `approved` rows, so if you later want a manual moderation queue you can
  insert new uploads as `pending` and flip them to `approved` from the Postgres
  dashboard (or build a tiny `/api/admin/*` route protected by a secret header)

## Known limitations / good next steps

- **Likes aren't strongly deduplicated.** The frontend disables the button per meme per
  browser (via `localStorage`), which stops casual re-clicking but not a determined
  user clearing storage or hitting the API directly. Fine for a meme gallery; if you
  want it airtight, add a `meme_likes (meme_id, ip_hash)` unique-constraint table.
- **No moderation UI yet.** Everything auto-approves. If spam/NSFW becomes an issue,
  switch new uploads to `status = 'pending'` in `memes-upload.js` and build a small
  password-protected admin page that lists pending rows and approves/rejects them.
- **No image resizing/thumbnails.** Vercel Blob serves the original file; for a busier
  gallery you'd add on-the-fly resizing (e.g. `@vercel/og` or a Vercel Image
  transformation) so the grid doesn't load full-size images.
