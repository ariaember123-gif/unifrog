(() => {
  'use strict';

  // If your API lives on the same domain (recommended: deploy the /api folder
  // alongside this site on Vercel), leave this as an empty string.
  const API_BASE = '';

  const grid = document.getElementById('memeGrid');
  const emptyMsg = document.getElementById('memeEmpty');
  const errorMsg = document.getElementById('memeError');
  const loadMoreBtn = document.getElementById('memeLoadMoreBtn');
  const sortTabs = document.querySelectorAll('.meme-sort-tab');

  const form = document.getElementById('memeUploadForm');
  const fileInput = document.getElementById('memeFileInput');
  const dropInner = document.getElementById('memeDropInner');
  const previewImg = document.getElementById('memePreviewImg');
  const uploaderInput = document.getElementById('memeUploaderInput');
  const captionInput = document.getElementById('memeCaptionInput');
  const submitBtn = document.getElementById('memeSubmitBtn');
  const statusEl = document.getElementById('memeUploadStatus');

  let state = { sort: 'new', page: 1, pageSize: 24, loading: false, hasMore: false };
  const likedIds = new Set(JSON.parse(localStorage.getItem('unifrog_liked_memes') || '[]'));

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function timeAgo(iso) {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    const steps = [
      [31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm'],
    ];
    for (const [secs, label] of steps) {
      const value = Math.floor(seconds / secs);
      if (value >= 1) return `${value}${label} ago`;
    }
    return 'just now';
  }

  function memeCardHtml(meme) {
    const liked = likedIds.has(meme.id);
    return `
      <article class="meme-card" data-id="${meme.id}">
        <div class="meme-card-img-wrap">
          <img src="${escapeHtml(meme.image_url)}" alt="${escapeHtml(meme.caption) || 'Community meme'}" loading="lazy">
        </div>
        <div class="meme-card-body">
          ${meme.caption ? `<p class="meme-card-caption">${escapeHtml(meme.caption)}</p>` : ''}
          <div class="meme-card-meta">
            <span class="meme-card-uploader">${escapeHtml(meme.uploader)} · ${timeAgo(meme.created_at)}</span>
            <button type="button" class="meme-like-btn ${liked ? 'liked' : ''}" data-id="${meme.id}" ${liked ? 'disabled' : ''}>
              ❤️ <span class="meme-like-count">${meme.likes}</span>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderSkeletons(n) {
    grid.insertAdjacentHTML('beforeend', Array.from({ length: n }).map(() => '<div class="meme-skeleton"></div>').join(''));
  }
  function clearSkeletons() {
    grid.querySelectorAll('.meme-skeleton').forEach((el) => el.remove());
  }

  async function loadMemes({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    errorMsg.hidden = true;
    loadMoreBtn.disabled = true;

    if (!append) grid.innerHTML = '';
    renderSkeletons(append ? 6 : 12);

    try {
      const url = `${API_BASE}/api/memes?sort=${state.sort}&page=${state.page}&pageSize=${state.pageSize}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load memes.');

      clearSkeletons();

      if (!append) grid.innerHTML = '';
      if (data.memes.length === 0 && !append) {
        emptyMsg.hidden = false;
      } else {
        emptyMsg.hidden = true;
        grid.insertAdjacentHTML('beforeend', data.memes.map(memeCardHtml).join(''));
      }

      state.hasMore = data.hasMore;
      loadMoreBtn.hidden = !data.hasMore;
    } catch (err) {
      clearSkeletons();
      errorMsg.textContent = err.message || 'Could not load the gallery.';
      errorMsg.hidden = false;
    } finally {
      state.loading = false;
      loadMoreBtn.disabled = false;
    }
  }

  sortTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      sortTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.sort = tab.dataset.sort;
      state.page = 1;
      loadMemes({ append: false });
    });
  });

  loadMoreBtn.addEventListener('click', () => {
    state.page += 1;
    loadMemes({ append: true });
  });

  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.meme-like-btn');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/memes-like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      btn.querySelector('.meme-like-count').textContent = data.likes;
      btn.classList.add('liked');
      likedIds.add(Number(id));
      localStorage.setItem('unifrog_liked_memes', JSON.stringify([...likedIds]));
    } catch {
      btn.disabled = false; // let them retry on failure
    }
  });

  // ---- Upload form ----
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      previewImg.src = reader.result;
      previewImg.hidden = false;
      dropInner.hidden = true;
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = 'meme-upload-status';

    if (!fileInput.files[0]) {
      statusEl.textContent = 'Choose an image first.';
      statusEl.classList.add('err');
      return;
    }

    const fd = new FormData();
    fd.append('image', fileInput.files[0]);
    fd.append('uploader', uploaderInput.value);
    fd.append('caption', captionInput.value);
    fd.append('website', form.website.value); // honeypot

    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting…';

    try {
      const res = await fetch(`${API_BASE}/api/memes-upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');

      statusEl.textContent = 'Posted! Your meme is live in the pond. 🐸';
      statusEl.classList.add('ok');
      form.reset();
      previewImg.hidden = true;
      dropInner.hidden = false;

      // Show it immediately at the top of the feed.
      if (state.sort === 'new') {
        grid.insertAdjacentHTML('afterbegin', memeCardHtml(data.meme));
        emptyMsg.hidden = true;
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Something went wrong. Try again.';
      statusEl.classList.add('err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '🐸 Post to the Pond';
    }
  });

  loadMemes();
})();
