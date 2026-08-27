(function(){
  "use strict";

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ---------------- responsive sizing ----------------
  // The stage's CSS box (see .game-stage) fills whatever space is left on
  // screen — a tall narrow box on phones, a wide short box on desktop.
  // Rather than stretching a fixed 900x430 drawing onto that box (which
  // distorted the frog/obstacles on mobile), the canvas' own coordinate
  // system now matches its real displayed size, and every gameplay
  // constant below scales off it, so the game looks correct at any size.
  const BASE_W = 900, BASE_H = 430; // design baseline used to derive the scale factor
  let WIDTH = 900, HEIGHT = 430, S = 1;
  let GROUND_Y = 340, FROG_X = 150, CHAR_SIZE = 132;
  let GRAVITY = 0.62, JUMP_SPEED = 13.4, BASE_SPEED = 5.6, MAX_SPEED = 12.5;

  function rescaleEntities(oldW, oldH){
    if(!oldW || !oldH) return;
    const sx = WIDTH / oldW, sy = HEIGHT / oldH;
    obstacles.forEach(o=>{ o.x *= sx; o.w *= sx; o.h *= sy; });
    stars.forEach(s=>{ s.x *= sx; s.y *= sy; });
    orbs.forEach(o=>{ o.x *= sx; o.y *= sy; });
    particles.forEach(p=>{ p.x *= sx; p.y *= sy; });
    frogY *= sy;
  }

  function resize(){
    const rect = canvas.getBoundingClientRect();
    const newW = Math.max(280, Math.round(rect.width || 900));
    const newH = Math.max(200, Math.round(rect.height || 430));
    const oldW = WIDTH, oldH = HEIGHT;
    WIDTH = newW; HEIGHT = newH;
    canvas.width = WIDTH * DPR;
    canvas.height = HEIGHT * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Scale off whichever dimension is tighter, not height alone. Phones
    // give the stage a narrow-but-tall box (lots of vertical space, little
    // width), so a height-only scale factor blew the frog/obstacles up way
    // past what actually fit the width — that's the "zoomed in" mobile bug.
    // Fitting to min(width, height) against the 900x430 design baseline
    // keeps everything sized to what's actually visible on screen.
    S = Math.min(WIDTH / BASE_W, HEIGHT / BASE_H);
    GROUND_Y = HEIGHT * (340/430);
    FROG_X = Math.max(80, Math.min(WIDTH * 0.167, 200));
    CHAR_SIZE = 132 * S;
    GRAVITY = 0.62 * S;
    JUMP_SPEED = 13.4 * S;
    BASE_SPEED = 5.6 * S;
    MAX_SPEED = 12.5 * S;

    rescaleEntities(oldW, oldH);
    if(overlaysReady) fitVisibleOverlays();
  }
  let overlaysReady = false; // set true once the overlay auto-fit is wired up below
  // (resize() is invoked once state variables below exist — see end of the
  // state block — since it rescales any live entities on resize.)

  // ---------------- assets ----------------
  const ASSET_PATH = 'assets/game/';
  const spriteNames = [
    'idle','run0','run1','run2','run3','run4','run5','run6','run4b_gallop',
    'jump','hit','gameover','power_star','speed_trail','shield',
    'cloud0','cloud1','cloud2','small_burst','yellow_streak','pink_streak'
  ];
  const img = {};
  spriteNames.forEach(name=>{
    const im = new Image();
    im.src = ASSET_PATH + name + '.png';
    img[name] = im;
  });

  const runFrames = [img.run0, img.run1, img.run2, img.run3, img.run4, img.run5, img.run6];
  const runFramesTurbo = [img.run0, img.run4b_gallop, img.run2, img.run4b_gallop, img.run4, img.run4b_gallop, img.run6];

  // ---------------- constants ----------------
  // GROUND_Y / FROG_X / CHAR_SIZE / GRAVITY / JUMP_SPEED / BASE_SPEED /
  // MAX_SPEED are declared above (responsive sizing block) and recomputed
  // in resize() so gameplay scales cleanly with the actual canvas size.
  const OBS_TYPES = [
    {type:'thorn',  w:56, h:46, c1:'#0B3D33', c2:'#8BBB4E'},
    {type:'rock',   w:70, h:40, c1:'#5c6b48', c2:'#7c8f5e'},
    {type:'flower', w:44, h:68, c1:'#E4176F', c2:'#FF4F9A'},
  ];

  // ---------------- state ----------------
  let state = 'start'; // start | playing | dead | paused
  let prevState = 'playing';
  let frogY = 0, frogVY = 0, grounded = true;
  let score = 0, best = Number(localStorage.getItem('unifrog_best') || 0);
  let speed = BASE_SPEED;
  let obstacles = [], stars = [], orbs = [], particles = [];
  let obstacleTimer = 0, starTimer = 0, orbTimer = 0;
  let runFrameIdx = 0, runFrameTimer = 0;
  let hitTimer = 0, invulnTimer = 0;
  let power = null; // {type:'star'|'turbo'|'shield'|'magnet', timeLeft}
  let muted = localStorage.getItem('unifrog_muted') === '1';
  let bgOffset = 0;
  let shakeTimer = 0;

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', ()=> setTimeout(resize, 250));
  if(window.ResizeObserver){
    new ResizeObserver(()=> resize()).observe(canvas);
  }

  // combo system
  let comboCount = 0, comboTimer = 0;
  const COMBO_WINDOW = 110; // frames-equivalent (dt units) to keep combo alive
  function comboMultiplier(){
    if(comboCount >= 10) return 2;
    if(comboCount >= 6) return 1.5;
    if(comboCount >= 3) return 1.25;
    return 1;
  }

  // milestones
  let lastMilestone = 0;
  const MILESTONE_STEP = 500;
  let milestoneTimer = 0;
  const milestoneMsgs = ['🔥 On fire!', '🐸 Legendary hop!', '🌟 Pond royalty!', '🚀 Unstoppable!', '💚 Frog king energy!'];

  // Shared leaderboard, lives on the server so every visitor sees the same top scores.
  const LEADERBOARD_API = 'api/leaderboard';
  let cachedLeaderboard = [];

  async function fetchLeaderboard(){
    try{
      const res = await fetch(LEADERBOARD_API);
      if(!res.ok) throw new Error('bad status');
      const data = await res.json();
      cachedLeaderboard = Array.isArray(data.entries) ? data.entries : [];
    }catch(e){
      // Backend unreachable — leave whatever we had cached (likely empty on first load).
    }
    return cachedLeaderboard;
  }
  function qualifiesForBoard(s){
    if(cachedLeaderboard.length < 5) return true;
    return s > Math.min(...cachedLeaderboard.map(e=>e.score));
  }
  async function submitToLeaderboard(name, s){
    try{
      const res = await fetch(LEADERBOARD_API, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name: (name||'FROG').toUpperCase().slice(0,12), score: s })
      });
      const data = await res.json();
      if(res.ok && Array.isArray(data.entries)) cachedLeaderboard = data.entries;
    }catch(e){
      // Submission failed silently — the score just won't appear on the shared board.
    }
    return cachedLeaderboard;
  }
  function renderBoard(el, list){
    if(!list.length){ el.innerHTML = '<li class="empty">No hops recorded yet — be the first!</li>'; return; }
    el.innerHTML = list.map((e,i)=>'<li><span class="rk">'+(i+1)+'</span><span class="nm">'+escapeHtml(e.name)+'</span><span>'+e.score+'</span></li>').join('');
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  const scoreValEl = document.getElementById('scoreVal');
  const bestValEl = document.getElementById('bestVal');
  const powerIndicatorEl = document.getElementById('powerIndicator');
  const comboIndicatorEl = document.getElementById('comboIndicator');
  const milestoneToastEl = document.getElementById('milestoneToast');
  const startOverlay = document.getElementById('startOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const muteBtn = document.getElementById('muteBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const shareBtn = document.getElementById('shareBtn');
  const lbEntry = document.getElementById('lbEntry');
  const lbNameInput = document.getElementById('lbNameInput');
  const lbSaveBtn = document.getElementById('lbSaveBtn');
  const startBoardList = document.getElementById('startBoardList');
  const endBoardList = document.getElementById('endBoardList');
  const stage = document.getElementById('gameStage');

  bestValEl.textContent = best;
  updateMuteBtn();
  renderBoard(startBoardList, []);
  fetchLeaderboard().then(list => { renderBoard(startBoardList, list); fitOverlay(startOverlay); });

  // ---------------- overlay auto-fit ----------------
  // Overlay content height varies (leaderboard entry form, new-best badge,
  // number of saved runs, font-loading reflow, etc), so rather than guess a
  // viewport-height breakpoint, measure the real content against the box
  // and shrink it (see .overlay.compact / .compact2 in the CSS) only when
  // it's actually needed. This is what keeps the game frame scroll-free.
  function fitOverlay(el){
    if(!el) return;
    el.classList.remove('compact', 'compact2');
    if(el.scrollHeight > el.clientHeight + 1){
      el.classList.add('compact');
    }
    if(el.scrollHeight > el.clientHeight + 1){
      el.classList.add('compact2');
    }
  }
  function fitVisibleOverlays(){
    [startOverlay, gameOverOverlay, pauseOverlay].forEach(o=>{
      if(o && !o.classList.contains('hidden')) fitOverlay(o);
    });
  }
  overlaysReady = true;
  fitOverlay(startOverlay);
  window.UniFrogFitOverlays = fitVisibleOverlays;

  // ---------------- audio ----------------
  let actx;
  function ensureAudio(){
    if(!actx){
      try{ actx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){}
    } else if(actx.state === 'suspended'){
      actx.resume();
    }
  }
  function beep(freq, dur, type, vol, sweepTo){
    if(muted || !actx) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    if(sweepTo) o.frequency.linearRampToValueAtTime(sweepTo, actx.currentTime + dur);
    g.gain.value = vol || 0.15;
    g.gain.linearRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur);
  }
  function sJump(){ beep(340, 0.13, 'sine', 0.12, 560); }
  function sCoin(){ beep(880, 0.09, 'square', 0.08, 1180); }
  function sPower(){ beep(500, 0.09, 'sine', 0.12, 760); setTimeout(()=>beep(760, 0.12, 'sine', 0.11, 1020), 90); }
  function sHit(){ beep(220, 0.32, 'sawtooth', 0.13, 60); }

  muteBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    muted = !muted;
    localStorage.setItem('unifrog_muted', muted ? '1' : '0');
    updateMuteBtn();
  });
  function updateMuteBtn(){ muteBtn.textContent = muted ? '🔇' : '🔊'; }

  // ---------------- spawning ----------------
  function spawnObstacle(){
    const weight = Math.min(1, score / 2000);
    const r = Math.random();
    let def;
    if (r < 0.42 - weight*0.15) def = OBS_TYPES[0];
    else if (r < 0.76 - weight*0.10) def = OBS_TYPES[1];
    else def = OBS_TYPES[2];
    obstacles.push({x: WIDTH + 20, w: def.w*S, h: def.h*S, type: def.type, c1: def.c1, c2: def.c2});
  }
  function spawnStar(){
    const heights = [GROUND_Y - 34*S, GROUND_Y - 95*S, GROUND_Y - 132*S];
    const y = heights[Math.floor(Math.random()*heights.length)];
    stars.push({x: WIDTH + 20, y, r: 11*S, t: Math.random()*Math.PI*2, collected: false});
  }
  function spawnOrb(){
    const types = ['power_star','speed_trail','shield','magnet'];
    const type = types[Math.floor(Math.random()*types.length)];
    orbs.push({x: WIDTH + 20, y: GROUND_Y - 92*S, type, t: Math.random()*Math.PI*2, collected: false});
  }
  function addBurst(x, y){ particles.push({x, y, life: 22, maxLife: 22}); }

  // ---------------- input ----------------
  function doJump(){
    ensureAudio();
    if(state === 'start'){ startGame(); return; }
    if(state !== 'playing') return;
    if(grounded){
      frogVY = (power && power.type === 'turbo') ? JUMP_SPEED * 1.14 : JUMP_SPEED;
      grounded = false;
      sJump();
    }
  }
  window.addEventListener('keydown', (e)=>{
    if(e.code === 'Space' || e.code === 'ArrowUp'){
      e.preventDefault();
      doJump();
    } else if(e.code === 'KeyP' || e.code === 'Escape'){
      e.preventDefault();
      togglePause();
    } else if(e.code === 'KeyR' && state === 'dead'){
      e.preventDefault();
      startGame();
    }
  });
  stage.addEventListener('pointerdown', (e)=>{
    if(e.target.closest('.btn') || e.target.closest('input')) return;
    doJump();
  });
  document.getElementById('startBtn').addEventListener('click', (e)=>{ e.stopPropagation(); startGame(); });
  document.getElementById('restartBtn').addEventListener('click', (e)=>{ e.stopPropagation(); startGame(); });

  pauseBtn.addEventListener('click', (e)=>{ e.stopPropagation(); togglePause(); });
  resumeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); togglePause(); });

  function togglePause(){
    if(state === 'playing'){
      prevState = state;
      state = 'paused';
      pauseOverlay.classList.remove('hidden');
      fitOverlay(pauseOverlay);
      pauseBtn.textContent = '▶️';
    } else if(state === 'paused'){
      state = prevState;
      pauseOverlay.classList.add('hidden');
      pauseBtn.textContent = '⏸';
    }
  }

  shareBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    const flooredScore = Math.floor(score);
    const text = 'I just hopped ' + flooredScore + 'm in UniFrog Hop Race 🐸💚 Can you beat me? $UNIFROG';
    if(navigator.share){
      navigator.share({ text, url: window.location.href }).catch(()=>{});
    } else {
      const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(window.location.href);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  lbSaveBtn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const name = (lbNameInput.value || 'FROG').trim();
    const flooredScore = Math.floor(score);
    lbSaveBtn.disabled = true;
    lbSaveBtn.textContent = 'Saving…';
    const list = await submitToLeaderboard(name, flooredScore);
    renderBoard(endBoardList, list);
    renderBoard(startBoardList, list);
    lbEntry.style.display = 'none';
    lbSaveBtn.disabled = false;
    lbSaveBtn.textContent = 'Save';
    fitOverlay(gameOverOverlay);
  });

  function startGame(){
    state = 'playing';
    frogY = 0; frogVY = 0; grounded = true;
    score = 0; speed = BASE_SPEED;
    obstacles = []; stars = []; orbs = []; particles = [];
    obstacleTimer = 60; starTimer = 100; orbTimer = 520;
    power = null; invulnTimer = 0; hitTimer = 0;
    comboCount = 0; comboTimer = 0;
    lastMilestone = 0; milestoneTimer = 0;
    runFrameIdx = 0; runFrameTimer = 0;
    pauseBtn.textContent = '⏸';
    startOverlay.classList.add('hidden');
    gameOverOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
  }

  function endGame(){
    state = 'dead';
    const flooredScore = Math.floor(score);
    const isNewBest = flooredScore > best;
    if(isNewBest){ best = flooredScore; localStorage.setItem('unifrog_best', best); }
    document.getElementById('finalScore').textContent = flooredScore;
    document.getElementById('finalBest').textContent = best;
    document.getElementById('newBestBadge').style.display = isNewBest ? 'inline-block' : 'none';
    bestValEl.textContent = best;

    if(qualifiesForBoard(flooredScore) && flooredScore > 0){
      lbEntry.style.display = 'block';
      lbNameInput.value = '';
    } else {
      lbEntry.style.display = 'none';
    }
    renderBoard(endBoardList, cachedLeaderboard);

    gameOverOverlay.classList.remove('hidden');
    fitOverlay(gameOverOverlay);
    sHit();
  }

  // ---------------- update ----------------
  function update(dt){
    if(state !== 'playing') return;

    speed = Math.min(MAX_SPEED, BASE_SPEED + score*0.0016);

    if(power){
      power.timeLeft -= dt;
      if(power.timeLeft <= 0) power = null;
    }
    if(invulnTimer > 0){ invulnTimer -= dt; if(invulnTimer < 0) invulnTimer = 0; }

    if(comboTimer > 0){
      comboTimer -= dt;
      if(comboTimer <= 0){ comboTimer = 0; comboCount = 0; }
    }
    if(milestoneTimer > 0){ milestoneTimer -= dt; if(milestoneTimer <= 0) milestoneToastEl.classList.remove('show'); }

    if(!grounded){
      frogY += frogVY*dt;
      frogVY -= GRAVITY*dt;
      if(frogY <= 0){ frogY = 0; frogVY = 0; grounded = true; }
    }

    const mult = (power && power.type === 'star') ? 2 : ((power && power.type === 'turbo') ? 1.5 : 1);
    score += speed*0.11*mult*dt;

    obstacleTimer -= dt;
    if(obstacleTimer <= 0){
      spawnObstacle();
      const diffFactor = Math.min(1, score/3000);
      const minF = 62 - diffFactor*8, maxF = 118 - diffFactor*20;
      obstacleTimer = minF + Math.random()*(maxF - minF);
    }
    starTimer -= dt;
    if(starTimer <= 0){ spawnStar(); starTimer = 90 + Math.random()*90; }
    orbTimer -= dt;
    if(orbTimer <= 0){ spawnOrb(); orbTimer = 560 + Math.random()*360; }

    obstacles.forEach(o=> o.x -= speed*dt);
    obstacles = obstacles.filter(o=> o.x + o.w > -20);
    stars.forEach(s=> s.x -= speed*dt);

    if(power && power.type === 'magnet'){
      const targetX = FROG_X, targetY = GROUND_Y - frogY - CHAR_SIZE*0.4 + 4;
      stars.forEach(s=>{
        if(s.collected) return;
        const dx = targetX - s.x, dy = targetY - s.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if(dist < 240*S){
          s.x += dx*0.10*dt;
          s.y += dy*0.10*dt;
        }
      });
    }

    stars = stars.filter(s=> s.x > -30 && !s.collected);
    orbs.forEach(o=> o.x -= speed*dt);
    orbs = orbs.filter(o=> o.x > -40 && !o.collected);
    particles.forEach(p=> p.life -= dt);
    particles = particles.filter(p=> p.life > 0);

    const frogBottom = GROUND_Y - frogY + 4;
    const frogTop = frogBottom - CHAR_SIZE*0.72;
    const frogLeft = FROG_X - CHAR_SIZE*0.28;
    const frogRight = FROG_X + CHAR_SIZE*0.30;

    if(hitTimer > 0){
      hitTimer -= dt;
      if(hitTimer <= 0){ hitTimer = 0; endGame(); }
    }

    if(state === 'playing' && invulnTimer <= 0 && hitTimer <= 0){
      for(const o of obstacles){
        const obsLeft = o.x, obsRight = o.x + o.w, obsTop = GROUND_Y - o.h, obsBottom = GROUND_Y;
        if(frogRight > obsLeft && frogLeft < obsRight && frogBottom > obsTop && frogTop < obsBottom){
          if(power && power.type === 'star'){
            addBurst(o.x + o.w/2, GROUND_Y - o.h/2);
            o.x = -9999;
          } else if(power && power.type === 'shield'){
            addBurst(o.x + o.w/2, GROUND_Y - o.h/2);
            o.x = -9999;
            power = null;
            invulnTimer = 40;
          } else {
            hitTimer = 20;
            shakeTimer = 14;
            addBurst(FROG_X, frogBottom - 30);
          }
          break;
        }
      }
    }

    for(const s of stars){
      if(s.collected) continue;
      const dx = FROG_X - s.x, dy = (frogBottom - CHAR_SIZE*0.4) - s.y;
      if(Math.sqrt(dx*dx + dy*dy) < 34*S){
        s.collected = true;
        comboCount++;
        comboTimer = COMBO_WINDOW;
        score += 15 * comboMultiplier();
        sCoin();
        addBurst(s.x, s.y);
      }
    }

    for(const o of orbs){
      if(o.collected) continue;
      const dx = FROG_X - o.x, dy = (frogBottom - CHAR_SIZE*0.4) - o.y;
      if(Math.sqrt(dx*dx + dy*dy) < 38*S){
        o.collected = true;
        score += 40;
        sPower();
        addBurst(o.x, o.y);
        const durations = {power_star: 300, speed_trail: 340, shield: 99999, magnet: 360};
        const map = {power_star: 'star', speed_trail: 'turbo', shield: 'shield', magnet: 'magnet'};
        power = {type: map[o.type], timeLeft: durations[o.type]};
      }
    }

    const flooredScore = Math.floor(score);
    if(flooredScore >= lastMilestone + MILESTONE_STEP){
      lastMilestone = Math.floor(flooredScore / MILESTONE_STEP) * MILESTONE_STEP;
      const msg = milestoneMsgs[Math.floor(Math.random()*milestoneMsgs.length)];
      milestoneToastEl.textContent = msg + ' ' + lastMilestone + 'm';
      milestoneToastEl.classList.add('show');
      milestoneTimer = 130;
    }

    scoreValEl.textContent = flooredScore;
    updatePowerChip();
    updateComboChip();
  }

  let lastPowerHtml = null, lastComboHtml = null;
  function updatePowerChip(){
    if(!power){
      if(lastPowerHtml !== ''){ powerIndicatorEl.innerHTML = ''; lastPowerHtml = ''; }
      return;
    }
    const labels = {
      star:  ['power_star.png', 'STAR PWR', 300],
      turbo: ['speed_trail.png', 'TURBO', 340],
      shield:['shield.png', 'SHIELD', 1],
      magnet:['', 'MAGNET', 360]
    };
    const [icon, label, total] = labels[power.type];
    const pct = power.type === 'shield' ? 100 : Math.max(0, (power.timeLeft/total)*100);
    const iconHtml = icon ? '<img src="' + ASSET_PATH + icon + '">' : '<span style="font-size:20px;line-height:1;">🧲</span>';
    const html = '<div class="power-chip show">' + iconHtml + '<span>' + label + '</span><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    if(html !== lastPowerHtml){ powerIndicatorEl.innerHTML = html; lastPowerHtml = html; }
  }

  function updateComboChip(){
    if(comboCount < 2 || state !== 'playing'){
      if(lastComboHtml !== ''){ comboIndicatorEl.innerHTML = ''; lastComboHtml = ''; }
      return;
    }
    const m = comboMultiplier();
    const html = '<div class="combo-chip show">🔥 COMBO ×' + m + '</div>';
    if(html !== lastComboHtml){ comboIndicatorEl.innerHTML = html; lastComboHtml = html; }
  }

  // ---------------- drawing ----------------
  function draw(){
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    if(shakeTimer > 0){
      shakeTimer -= 1;
      const mag = Math.min(6, shakeTimer*0.5);
      ctx.translate((Math.random()-0.5)*mag, (Math.random()-0.5)*mag);
    }

    // ---- sky ----
    const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    skyGrad.addColorStop(0, '#BFEBDD');
    skyGrad.addColorStop(0.55, '#DFF2E6');
    skyGrad.addColorStop(1, '#F7F4EE');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, GROUND_Y);

    // ---- soft sun glow ----
    ctx.save();
    const sunX = WIDTH*0.82, sunY = GROUND_Y*0.22;
    const sunR = Math.max(WIDTH, HEIGHT)*0.28;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sunGrad.addColorStop(0, 'rgba(255,246,214,.9)');
    sunGrad.addColorStop(0.4, 'rgba(255,231,150,.35)');
    sunGrad.addColorStop(1, 'rgba(255,231,150,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // ---- tinted haze pools (kept from original palette, relative sizing) ----
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = '#FF4F9A';
    ctx.beginPath(); ctx.ellipse(WIDTH*0.80, GROUND_Y*0.20, WIDTH*0.155, GROUND_Y*0.26, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#8BBB4E';
    ctx.globalAlpha = 0.20;
    ctx.beginPath(); ctx.ellipse(WIDTH*0.13, GROUND_Y*0.17, WIDTH*0.133, GROUND_Y*0.23, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    if(state === 'playing') bgOffset += speed*0.35;

    // ---- distant parallax hills (two layers, slow scroll) ----
    drawHillLayer(GROUND_Y - HEIGHT*0.02, HEIGHT*0.10, 'rgba(139,187,78,.20)', bgOffset*0.12, WIDTH*0.42);
    drawHillLayer(GROUND_Y + HEIGHT*0.01, HEIGHT*0.14, 'rgba(11,61,51,.14)', bgOffset*0.22, WIDTH*0.34);

    // ---- clouds ----
    const cloudImgs = [img.cloud0, img.cloud1, img.cloud2];
    const cloudW = 92*S, cloudH = 48*S;
    for(let i=0; i<3; i++){
      const cy = (34 + i*28) * S;
      const cx = (WIDTH + 220*S) - ((bgOffset*(0.5 + i*0.15) + i*320*S) % (WIDTH + 440*S));
      ctx.globalAlpha = 0.55;
      ctx.drawImage(cloudImgs[i], cx, cy, cloudW, cloudH);
    }
    ctx.globalAlpha = 1;

    // ---- ground ----
    const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, HEIGHT);
    groundGrad.addColorStop(0, '#E7DFC9');
    groundGrad.addColorStop(1, '#EEE8DA');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);

    // subtle water-ripple texture across the ground band
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#8BBB4E';
    ctx.lineWidth = 1.5*S;
    const rippleGap = 26*S;
    for(let ry = GROUND_Y + 14*S; ry < HEIGHT; ry += rippleGap){
      ctx.beginPath();
      const waveOff = (-bgOffset*0.6) % (44*S);
      for(let rx = -44*S + waveOff; rx < WIDTH + 44*S; rx += 44*S){
        ctx.moveTo(rx, ry);
        ctx.quadraticCurveTo(rx + 22*S, ry - 6*S, rx + 44*S, ry);
      }
      ctx.stroke();
    }
    ctx.restore();

    // top edge line of the swamp bank
    ctx.strokeStyle = 'rgba(228,23,111,.35)';
    ctx.lineWidth = 3*S;
    ctx.setLineDash([14*S, 12*S]);
    ctx.lineDashOffset = -bgOffset*2;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y + 1); ctx.lineTo(WIDTH, GROUND_Y + 1); ctx.stroke();
    ctx.setLineDash([]);

    // small reed/grass tufts along the bank for depth
    drawReeds();

    obstacles.forEach(drawObstacle);

    stars.forEach(s=>{
      if(s.collected) return;
      s.t += 0.08;
      drawStar(s.x, s.y + Math.sin(s.t)*4, s.r, '#FFC93C', '#E4176F');
    });

    orbs.forEach(o=>{
      if(o.collected) return;
      o.t += 0.06;
      const yy = o.y + Math.sin(o.t)*6;
      ctx.save();
      ctx.shadowColor = 'rgba(228,23,111,.5)';
      ctx.shadowBlur = 14*S;
      if(o.type === 'magnet'){
        ctx.font = (38*S) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🧲', o.x, yy);
      } else {
        ctx.drawImage(img[o.type], o.x - 23*S, yy - 23*S, 46*S, 46*S);
      }
      ctx.restore();
    });

    drawFrog();

    particles.forEach(p=>{
      const a = Math.max(0, p.life/p.maxLife);
      ctx.globalAlpha = a;
      ctx.drawImage(img.small_burst, p.x - 30*S, p.y - 24*S, 60*S, 48*S);
    });
    ctx.globalAlpha = 1;

    if(hitTimer > 0){
      ctx.fillStyle = 'rgba(228,23,111,' + (0.18*(hitTimer/20)) + ')';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // soft vignette for a more polished, professional frame
    const vig = ctx.createRadialGradient(WIDTH/2, HEIGHT*0.55, HEIGHT*0.35, WIDTH/2, HEIGHT*0.55, HEIGHT*0.95);
    vig.addColorStop(0, 'rgba(11,61,51,0)');
    vig.addColorStop(1, 'rgba(11,61,51,.10)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.restore();

    if(state === 'paused'){
      ctx.fillStyle = 'rgba(10,20,16,.28)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  // gentle rolling hill silhouette, tiled and parallax-scrolled
  function drawHillLayer(baseY, amp, color, offset, wavelength){
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    const step = wavelength / 2;
    const start = -((offset) % wavelength) - wavelength;
    for(let x = start; x < WIDTH + wavelength; x += step){
      const y = baseY - amp * (1 + Math.sin((x + offset*0.4) / wavelength * Math.PI));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WIDTH, baseY);
    ctx.lineTo(WIDTH, GROUND_Y);
    ctx.lineTo(0, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // small reed/grass tufts along the bank edge, scrolling with the ground
  function drawReeds(){
    ctx.save();
    ctx.strokeStyle = 'rgba(11,61,51,.28)';
    ctx.lineWidth = 2*S;
    ctx.lineCap = 'round';
    const gap = 70*S;
    const off = (-bgOffset*1.4) % gap;
    for(let x = off; x < WIDTH; x += gap){
      const baseX = x, baseY = GROUND_Y + 2;
      for(let i=-1; i<=1; i++){
        ctx.beginPath();
        ctx.moveTo(baseX + i*4*S, baseY);
        ctx.quadraticCurveTo(baseX + i*10*S, baseY - 14*S, baseX + i*6*S, baseY - 22*S);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawStar(cx, cy, r, fill, stroke){
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for(let i=0; i<5; i++){
      const a1 = -Math.PI/2 + i*(Math.PI*2/5);
      const a2 = a1 + Math.PI/5;
      ctx.lineTo(Math.cos(a1)*r, Math.sin(a1)*r);
      ctx.lineTo(Math.cos(a2)*(r*0.42), Math.sin(a2)*(r*0.42));
    }
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = stroke; ctx.stroke();
    ctx.restore();
  }

  function drawObstacle(o){
    const baseY = GROUND_Y;
    ctx.save();

    // grounding shadow beneath every obstacle
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#0B3D33';
    ctx.beginPath();
    ctx.ellipse(o.x + o.w/2, baseY + 3*S, o.w*0.46, 5*S, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    if(o.type === 'thorn'){
      const n = 3, seg = o.w/n;
      for(let i=0; i<n; i++){
        const hh = o.h * (i === 1 ? 1 : 0.72);
        const grad = ctx.createLinearGradient(0, baseY - hh, 0, baseY);
        grad.addColorStop(0, i % 2 ? o.c2 : o.c1);
        grad.addColorStop(1, '#0A1410');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(o.x + i*seg, baseY);
        ctx.lineTo(o.x + i*seg + seg/2, baseY - hh);
        ctx.lineTo(o.x + i*seg + seg, baseY);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1*S; ctx.stroke();
      }
    } else if(o.type === 'rock'){
      const g1 = ctx.createRadialGradient(o.x+o.w*0.24, baseY-o.h*0.6, 2, o.x+o.w*0.32, baseY-o.h*0.4, o.w*0.5);
      g1.addColorStop(0, '#8b9a6e'); g1.addColorStop(1, o.c1);
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.ellipse(o.x + o.w*0.32, baseY - o.h*0.4, o.w*0.34, o.h*0.55, 0, 0, Math.PI*2); ctx.fill();
      const g2 = ctx.createRadialGradient(o.x+o.w*0.6, baseY-o.h*0.5, 2, o.x+o.w*0.68, baseY-o.h*0.32, o.w*0.5);
      g2.addColorStop(0, '#9fb27b'); g2.addColorStop(1, o.c2);
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.ellipse(o.x + o.w*0.68, baseY - o.h*0.32, o.w*0.36, o.h*0.46, 0, 0, Math.PI*2); ctx.fill();
    } else if(o.type === 'flower'){
      ctx.strokeStyle = o.c1; ctx.lineWidth = 8*S; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(o.x + o.w/2, baseY); ctx.lineTo(o.x + o.w/2, baseY - o.h); ctx.stroke();
      const petalGrad = ctx.createRadialGradient(o.x+o.w/2, baseY-o.h, 1, o.x+o.w/2, baseY-o.h, 16*S);
      petalGrad.addColorStop(0, '#FFC3DE'); petalGrad.addColorStop(1, o.c2);
      for(let i=0; i<5; i++){
        const ang = i*(Math.PI*2/5);
        ctx.fillStyle = petalGrad;
        ctx.beginPath();
        ctx.ellipse(o.x + o.w/2 + Math.cos(ang)*15*S, baseY - o.h + Math.sin(ang)*15*S, 9*S, 5*S, ang, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.fillStyle = '#FFC93C';
      ctx.beginPath(); ctx.arc(o.x + o.w/2, baseY - o.h, 8*S, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawFrog(){
    let sprite;
    if(state === 'dead'){
      sprite = img.gameover;
    } else if(hitTimer > 0){
      sprite = img.hit;
    } else if(!grounded){
      sprite = img.jump;
    } else if(power && power.type === 'star'){
      sprite = img.power_star;
    } else if(power && power.type === 'turbo'){
      sprite = img.speed_trail;
    } else {
      const frames = (power && power.type === 'turbo') ? runFramesTurbo : runFrames;
      runFrameTimer++;
      const cyc = Math.max(3, 9 - Math.floor(speed/1.6));
      if(runFrameTimer >= cyc){ runFrameTimer = 0; runFrameIdx = (runFrameIdx + 1) % frames.length; }
      sprite = frames[runFrameIdx];
    }

    const bottom = GROUND_Y - frogY + 4;
    const drawX = FROG_X - CHAR_SIZE/2;
    const drawY = bottom - CHAR_SIZE;

    // contact shadow — shrinks and softens the higher the frog jumps
    ctx.save();
    const jumpFrac = Math.min(1, frogY / (JUMP_SPEED*6));
    ctx.globalAlpha = 0.28 * (1 - jumpFrac*0.7);
    ctx.fillStyle = '#0B3D33';
    ctx.beginPath();
    ctx.ellipse(FROG_X, GROUND_Y + 3*S, CHAR_SIZE*0.34*(1-jumpFrac*0.3), 7*S*(1-jumpFrac*0.4), 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    if(power && power.type === 'turbo'){
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img.yellow_streak, drawX - 70*S, drawY + CHAR_SIZE*0.35, 74*S, 34*S);
      ctx.restore();
    }
    if(power && power.type === 'star'){
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.drawImage(img.pink_streak, drawX - 60*S, drawY + CHAR_SIZE*0.30, 64*S, 30*S);
      ctx.restore();
    }

    ctx.save();
    if(invulnTimer > 0 && Math.floor(invulnTimer/4) % 2 === 0){ ctx.globalAlpha = 0.4; }
    ctx.drawImage(sprite, drawX, drawY, CHAR_SIZE, CHAR_SIZE);
    ctx.restore();

    if(power && power.type === 'shield'){
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img.shield, drawX - 6*S, drawY - 6*S, CHAR_SIZE + 12*S, CHAR_SIZE + 12*S);
      ctx.restore();
    }

    if(power && power.type === 'magnet'){
      ctx.save();
      const pulse = (6 + Math.sin(performance.now()/140)*4) * S;
      ctx.strokeStyle = 'rgba(11,61,51,.5)';
      ctx.lineWidth = 2*S;
      ctx.setLineDash([6*S,6*S]);
      ctx.beginPath();
      ctx.arc(FROG_X, bottom - CHAR_SIZE*0.4, CHAR_SIZE*0.62 + pulse, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ---------------- loop ----------------
  let lastTime = performance.now();
  function loop(now){
    const delta = now - lastTime;
    lastTime = now;
    const dt = Math.min(2, Math.max(0, delta/16.6667));
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

})();
