(function () {
  const matchId = location.pathname.split('/').filter(Boolean).pop();
  if (!matchId) {
    return;
  }

  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d');

  const els = {
    meta: document.getElementById('meta'),
    time: document.getElementById('time'),
    status: document.getElementById('status'),
    phaseLabel: document.getElementById('phase-label'),
    distance: document.getElementById('distance'),
    tick: document.getElementById('tick'),
    aName: document.getElementById('a-name'),
    bName: document.getElementById('b-name'),
    aHp: document.getElementById('a-hp'),
    bHp: document.getElementById('b-hp'),
    aEnergy: document.getElementById('a-energy'),
    bEnergy: document.getElementById('b-energy'),
    aAction: document.getElementById('a-action'),
    bAction: document.getElementById('b-action'),
    aHpBar: document.getElementById('a-hp-bar'),
    bHpBar: document.getElementById('b-hp-bar'),
    aEnBar: document.getElementById('a-en-bar'),
    bEnBar: document.getElementById('b-en-bar'),
    log: document.getElementById('log'),
    result: document.getElementById('result'),
    summary: document.getElementById('summary'),
    reportLink: document.getElementById('report-link'),
  };

  // === Color palettes ===
  var PALETTE_A = {
    base: '#b91c1c', highlight: '#ef4444', shadow: '#7f1d1d', belly: '#fca5a5',
    eye: '#fef08a', clawInner: '#dc2626',
  };
  var PALETTE_B = {
    base: '#1e40af', highlight: '#3b82f6', shadow: '#1e3a5f', belly: '#93c5fd',
    eye: '#bfdbfe', clawInner: '#2563eb',
  };

  let targetState = null;
  var anim = {
    aPos: 25,
    bPos: 75,
    aHp: 100,
    bHp: 100,
    flashA: 0,
    flashB: 0,
    particles: [],
    damagePopups: [],
    shakeMag: 0,
    shakeDur: 0,
    actionStartTimeA: 0,
    actionStartTimeB: 0,
    prevActionA: 'idle',
    prevActionB: 'idle',
  };

  init().catch(function (err) {
    console.error(err);
  });

  async function init() {
    await refreshState();
    connectEvents();
    requestAnimationFrame(loop);
  }

  async function refreshState() {
    var response = await fetch('/api/matches/' + matchId + '/state');
    if (!response.ok) {
      throw new Error('state fetch failed (' + response.status + ')');
    }
    var state = await response.json();
    applyState(state);
  }

  var reconnectDelay = 2000;

  function connectEvents() {
    var es = new EventSource('/api/matches/' + matchId + '/events');
    var consume = function (event) {
      try {
        var parsed = JSON.parse(event.data);
        if (parsed && parsed.state) {
          applyState(parsed.state);
        }
      } catch (err) {
        console.warn('Bad SSE payload', err);
      }
    };

    es.addEventListener('state', consume);
    es.addEventListener('event', consume);
    es.addEventListener('end', consume);

    es.onopen = function () {
      reconnectDelay = 2000;
    };

    es.onerror = async function () {
      es.close();
      var delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      setTimeout(connectEvents, delay);
      try {
        await refreshState();
      } catch (e) {
        // ignore transient reconnect errors
      }
    };
  }

  function applyState(state) {
    if (!state || !state.fighters) {
      return;
    }

    if (targetState && targetState.fighters && state.fighters) {
      var prevA = targetState.fighters[0];
      var prevB = targetState.fighters[1];
      var newA = state.fighters[0];
      var newB = state.fighters[1];

      if (newA.hp < prevA.hp) {
        anim.flashA = 1;
        var dmgA = prevA.hp - newA.hp;
        spawnHitParticles(anim.aPos, dmgA > 15);
        spawnDamagePopup(anim.aPos, dmgA);
        if (dmgA > 15) triggerShake(4, 8);
      }
      if (newB.hp < prevB.hp) {
        anim.flashB = 1;
        var dmgB = prevB.hp - newB.hp;
        spawnHitParticles(anim.bPos, dmgB > 15);
        spawnDamagePopup(anim.bPos, dmgB);
        if (dmgB > 15) triggerShake(4, 8);
      }

      // Counter reflection VFX: when a counter user reflects damage to the attacker
      if (newA.currentAction === 'counter' && newB.hp < prevB.hp) {
        spawnCounterParticles(anim.aPos);
      }
      if (newB.currentAction === 'counter' && newA.hp < prevA.hp) {
        spawnCounterParticles(anim.bPos);
      }

      // Track action changes for animation timing
      if (newA.currentAction !== anim.prevActionA) {
        anim.actionStartTimeA = Date.now();
        anim.prevActionA = newA.currentAction;
        if (newA.currentAction === 'forward' || newA.currentAction === 'dash_attack') {
          spawnDustParticles(anim.aPos);
        }
        if (newA.currentAction === 'special') {
          triggerShake(6, 12);
          spawnSpecialParticles(anim.aPos);
        }
      }
      if (newB.currentAction !== anim.prevActionB) {
        anim.actionStartTimeB = Date.now();
        anim.prevActionB = newB.currentAction;
        if (newB.currentAction === 'forward' || newB.currentAction === 'dash_attack') {
          spawnDustParticles(anim.bPos);
        }
        if (newB.currentAction === 'special') {
          triggerShake(6, 12);
          spawnSpecialParticles(anim.bPos);
        }
      }
    }

    targetState = state;

    var a = state.fighters[0];
    var b = state.fighters[1];

    els.meta.textContent = 'Match ' + state.id.slice(0, 8);
    els.time.textContent = String(state.timeRemaining);
    els.status.textContent = state.status;
    els.phaseLabel.textContent = phaseMessage(state);
    els.distance.textContent = state.distance.toFixed(1);
    els.tick.textContent = String(state.tick);

    els.aName.textContent = a.name ? a.slot + ': ' + a.name : 'Fighter A';
    els.bName.textContent = b.name ? b.slot + ': ' + b.name : 'Fighter B (waiting)';
    els.aHp.textContent = String(Math.round(a.hp));
    els.bHp.textContent = String(Math.round(b.hp));
    els.aEnergy.textContent = String(Math.round(a.energy));
    els.bEnergy.textContent = String(Math.round(b.energy));
    els.aAction.textContent = a.currentAction;
    els.bAction.textContent = b.currentAction;

    els.aHpBar.style.width = Math.max(0, a.hp) + '%';
    els.bHpBar.style.width = Math.max(0, b.hp) + '%';
    els.aEnBar.style.width = Math.max(0, a.energy) + '%';
    els.bEnBar.style.width = Math.max(0, b.energy) + '%';

    syncLog(state.recentEvents || []);

    if (state.status === 'finished') {
      els.result.classList.remove('hidden');
      els.summary.textContent = state.summary || 'Match over.';
      els.reportLink.href = '/api/matches/' + state.id + '/report';
    } else {
      els.result.classList.add('hidden');
    }
  }

  function phaseMessage(state) {
    if (state.status === 'waiting') return 'Waiting for second fighter to join...';
    if (state.status === 'running') return 'Match is live!';
    return 'Match finished.';
  }

  function syncLog(events) {
    var items = events.slice(-16).map(function (event) {
      var li = document.createElement('li');
      li.textContent = '[' + event.tick + '] ' + event.type + ': ' + event.message;
      return li;
    });
    els.log.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      els.log.appendChild(items[i]);
    }
  }

  // =========================================================================
  //  Particle System
  // =========================================================================

  function spawnHitParticles(posNorm, heavy) {
    var count = heavy ? 18 : 10;
    var w = canvas.width;
    var h = canvas.height;
    var cx = (0.5 + posNorm / 100) * w - w / 2;
    var cy = h * 0.55;
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 1.5 + Math.random() * 3 * (heavy ? 1.5 : 1);
      anim.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 20 + Math.random() * 10,
        maxLife: 25,
        size: 2 + Math.random() * 3,
        color: heavy ? '#fbbf24' : '#fef08a',
      });
    }
  }

  function spawnDustParticles(posNorm) {
    var w = canvas.width;
    var h = canvas.height;
    var cx = (0.5 + posNorm / 100) * w - w / 2;
    var cy = h * 0.76;
    for (var i = 0; i < 4; i++) {
      anim.particles.push({
        x: cx + (Math.random() - 0.5) * 20,
        y: cy,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -0.3 - Math.random() * 0.8,
        life: 20 + Math.random() * 10,
        maxLife: 30,
        size: 3 + Math.random() * 4,
        color: 'rgba(180,170,150,0.5)',
      });
    }
  }

  function spawnSpecialParticles(posNorm) {
    var w = canvas.width;
    var h = canvas.height;
    var cx = (0.5 + posNorm / 100) * w - w / 2;
    var cy = h * 0.55;
    for (var i = 0; i < 20; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 2 + Math.random() * 4;
      anim.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 15 + Math.random() * 15,
        maxLife: 25,
        size: 3 + Math.random() * 4,
        color: Math.random() < 0.5 ? '#f59e0b' : '#ffffff',
      });
    }
  }

  function spawnCounterParticles(posNorm) {
    var w = canvas.width;
    var h = canvas.height;
    var cx = (0.5 + posNorm / 100) * w - w / 2;
    var cy = h * 0.6;
    for (var i = 0; i < 10; i++) {
      var angle = (i / 10) * Math.PI * 2;
      anim.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * 3,
        vy: Math.sin(angle) * 3,
        life: 10,
        maxLife: 10,
        size: 4,
        color: '#ffffff',
      });
    }
  }

  function updateParticles() {
    for (var i = anim.particles.length - 1; i >= 0; i--) {
      var p = anim.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life -= 1;
      if (p.life <= 0) {
        anim.particles.splice(i, 1);
      }
    }
  }

  function drawParticles() {
    for (var i = 0; i < anim.particles.length; i++) {
      var p = anim.particles[i];
      var alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // =========================================================================
  //  Damage Popups
  // =========================================================================

  function spawnDamagePopup(posNorm, damage) {
    var w = canvas.width;
    var h = canvas.height;
    var cx = (0.5 + posNorm / 100) * w - w / 2;
    anim.damagePopups.push({
      x: cx + (Math.random() - 0.5) * 20,
      y: h * 0.42,
      text: '-' + damage,
      life: 30,
      maxLife: 30,
    });
  }

  function updatePopups() {
    for (var i = anim.damagePopups.length - 1; i >= 0; i--) {
      var p = anim.damagePopups[i];
      p.y -= 1.3;
      p.life -= 1;
      if (p.life <= 0) {
        anim.damagePopups.splice(i, 1);
      }
    }
  }

  function drawPopups() {
    for (var i = 0; i < anim.damagePopups.length; i++) {
      var p = anim.damagePopups[i];
      var alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '700 18px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  // =========================================================================
  //  Screen Shake
  // =========================================================================

  function triggerShake(mag, dur) {
    if (mag > anim.shakeMag) {
      anim.shakeMag = mag;
      anim.shakeDur = dur;
    }
  }

  function applyShake() {
    if (anim.shakeDur > 0) {
      var ox = (Math.random() - 0.5) * 2 * anim.shakeMag;
      var oy = (Math.random() - 0.5) * 2 * anim.shakeMag;
      ctx.translate(ox, oy);
      anim.shakeDur -= 1;
      if (anim.shakeDur <= 0) {
        anim.shakeMag = 0;
      }
    }
  }

  // =========================================================================
  //  Main Loop
  // =========================================================================

  function loop() {
    if (targetState && targetState.fighters) {
      var a = targetState.fighters[0];
      var b = targetState.fighters[1];

      anim.aPos += (a.position - anim.aPos) * 0.13;
      anim.bPos += (b.position - anim.bPos) * 0.13;
      anim.aHp += (a.hp - anim.aHp) * 0.2;
      anim.bHp += (b.hp - anim.bHp) * 0.2;

      anim.flashA *= 0.88;
      anim.flashB *= 0.88;

      updateParticles();
      updatePopups();

      renderArena(a, b);
    }

    requestAnimationFrame(loop);
  }

  // =========================================================================
  //  Arena Rendering
  // =========================================================================

  function renderArena(a, b) {
    var w = canvas.width;
    var h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    applyShake();

    drawBackground(w, h);

    var isActive = targetState && (targetState.status === 'running' || targetState.status === 'finished');
    var aReady = Boolean(a.name);
    var bReady = Boolean(b.name);

    var tA = (Date.now() - anim.actionStartTimeA) / 1000;
    var tB = (Date.now() - anim.actionStartTimeB) / 1000;

    drawFighter(0.5 + anim.aPos / 100, 0.72, PALETTE_A, true, a.currentAction, anim.flashA, isActive, aReady, tA);
    drawFighter(0.5 + anim.bPos / 100, 0.72, PALETTE_B, false, b.currentAction, anim.flashB, isActive, bReady, tB);

    drawParticles();
    drawPopups();

    ctx.restore();

    if (!isActive) {
      ctx.save();
      ctx.fillStyle = 'rgba(7, 15, 30, 0.45)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 30px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(targetState ? targetState.status.toUpperCase() : 'LOADING', w / 2, h / 2);
      ctx.restore();
    }
  }

  function drawBackground(w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    for (var i = 0; i < 5; i += 1) {
      var x = (i + 0.5) * (w / 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.moveTo(x, h * 0.76);
      ctx.lineTo(x, h * 0.97);
      ctx.stroke();
    }
    ctx.restore();
  }

  // =========================================================================
  //  Lobster Drawing
  // =========================================================================

  function drawFighter(nx, ny, palette, facingRight, action, flash, isActive, isReady, t) {
    var w = canvas.width;
    var h = canvas.height;
    var x = nx * w - w / 2;
    var y = ny * h;

    var now = Date.now();

    // --- Pose calculations ---
    var bob = isActive ? Math.sin(now / 140) * 3 : 0;
    var bodyTilt = 0;   // rotation in radians
    var squat = 0;      // vertical offset for crouching
    var dashOffset = 0; // horizontal offset for dash
    var clawMode = 'idle'; // which claw animation

    if (isActive) {
      switch (action) {
        case 'idle':
          clawMode = 'idle';
          break;
        case 'forward':
          bodyTilt = 0.08;
          clawMode = 'forward';
          break;
        case 'backward':
          bodyTilt = -0.08;
          clawMode = 'backward';
          break;
        case 'guard':
          squat = 3;
          clawMode = 'guard';
          break;
        case 'light_attack':
          bodyTilt = 0.05;
          clawMode = 'light';
          break;
        case 'heavy_attack':
          bodyTilt = t < 0.15 ? -0.12 : 0.15;
          clawMode = 'heavy';
          break;
        case 'dash_attack':
          bodyTilt = 0.1;
          dashOffset = Math.max(0, 1 - t * 4) * 20;
          clawMode = 'dash';
          break;
        case 'counter':
          squat = 5;
          clawMode = 'counter';
          break;
        case 'special':
          bodyTilt = t < 0.2 ? (Math.sin(now / 20) * 0.05) : 0.12;
          squat = t < 0.2 ? 2 : -3;
          clawMode = 'special';
          break;
      }
    }

    var dir = facingRight ? 1 : -1;

    ctx.save();
    ctx.translate(x + dashOffset * dir, y + bob + squat);
    ctx.scale(dir, 1);
    ctx.rotate(bodyTilt);

    var col = isReady ? palette : {
      base: 'rgba(148,163,184,0.7)', highlight: 'rgba(180,190,200,0.7)',
      shadow: 'rgba(100,110,120,0.7)', belly: 'rgba(200,210,220,0.7)',
      eye: '#cbd5e1', clawInner: 'rgba(160,170,180,0.7)',
    };

    // Flash overlay
    if (flash > 0.05 && isActive) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(0.5, flash) + ')';
      ctx.beginPath();
      ctx.ellipse(0, -35, 40, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawShadow(col);
    drawTailFan(col, action, now);
    drawTailSegments(col);
    drawWalkingLegs(col, action, now);
    drawCarapace(col);
    drawMandibles(col);
    drawEyeStalks(col, action, now);
    drawAntennae(col, now);
    drawClaws(col, clawMode, now, t);

    // Guard shield effect
    if (action === 'guard' && isActive) {
      drawGuardShield(col, now);
    }

    // Counter glow
    if (action === 'counter' && isActive) {
      drawCounterGlow(col, now);
    }

    // Special charge aura
    if (action === 'special' && isActive && t < 0.3) {
      drawSpecialAura(col, now);
    }

    // Light attack trail
    if (action === 'light_attack' && isActive && t < 0.3) {
      drawAttackTrail(col, t);
    }

    // Dash afterimage
    if (action === 'dash_attack' && isActive && t < 0.3) {
      drawDashAfterimage(col, t);
    }

    ctx.restore();
  }

  // --- Lobster body parts ---

  function drawShadow() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 38, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTailFan(col, action, now) {
    ctx.save();
    ctx.translate(-55, -26);
    var curl = action === 'backward' ? -0.15 : 0;
    ctx.rotate(curl);

    for (var i = 0; i < 5; i++) {
      var angle = -0.4 + (i * 0.2);
      var sway = Math.sin(now / 300 + i * 0.5) * 0.03;
      ctx.save();
      ctx.rotate(angle + sway);
      ctx.fillStyle = col.highlight;
      ctx.globalAlpha = 0.6 + i * 0.08;
      ctx.beginPath();
      ctx.ellipse(-12, 0, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawTailSegments(col) {
    var segments = [
      { x: -40, y: -28, w: 14, h: 10 },
      { x: -50, y: -30, w: 12, h: 9 },
      { x: -58, y: -29, w: 10, h: 8 },
    ];
    ctx.save();
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      ctx.fillStyle = i === 0 ? col.base : col.shadow;
      roundRect(s.x, s.y, s.w, s.h, 3);
    }
    ctx.restore();
  }

  function drawWalkingLegs(col, action, now) {
    ctx.save();
    ctx.strokeStyle = col.shadow;
    ctx.lineWidth = 2;
    var phase = action === 'forward' || action === 'dash_attack' ? now / 80 : now / 300;

    for (var i = 0; i < 4; i++) {
      var baseX = -18 + i * 12;
      var baseY = -12;
      var step = Math.sin(phase + i * 1.5) * 4;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(baseX - 4, baseY + 12 + step);
      ctx.lineTo(baseX - 8, baseY + 22 + step * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCarapace(col) {
    ctx.save();

    // Main shell - ellipse with radial gradient
    var grd = ctx.createRadialGradient(0, -35, 5, 0, -35, 30);
    grd.addColorStop(0, col.highlight);
    grd.addColorStop(0.6, col.base);
    grd.addColorStop(1, col.shadow);

    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, -35, 28, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly underside
    ctx.fillStyle = col.belly;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(0, -28, 20, 8, 0, 0, Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Shell ridges
    ctx.strokeStyle = col.shadow;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(0, -37, 22, 12, 0, -0.3, Math.PI + 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -36, 16, 8, 0, -0.2, Math.PI + 0.2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawMandibles(col) {
    ctx.save();
    ctx.fillStyle = col.shadow;

    // Two small mandible triangles
    ctx.beginPath();
    ctx.moveTo(24, -30);
    ctx.lineTo(30, -34);
    ctx.lineTo(28, -28);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(24, -32);
    ctx.lineTo(31, -38);
    ctx.lineTo(29, -31);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawEyeStalks(col, action, now) {
    ctx.save();
    var glow = action === 'counter' ? 1 : 0;

    // Left eye stalk
    ctx.strokeStyle = col.base;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, -44);
    ctx.lineTo(10, -54);
    ctx.stroke();

    // Left eye
    ctx.fillStyle = glow ? '#fef08a' : col.eye;
    ctx.beginPath();
    ctx.arc(10, -56, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(11, -56, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Right eye stalk
    ctx.strokeStyle = col.base;
    ctx.beginPath();
    ctx.moveTo(18, -44);
    ctx.lineTo(20, -56);
    ctx.stroke();

    // Right eye
    ctx.fillStyle = glow ? '#fef08a' : col.eye;
    ctx.beginPath();
    ctx.arc(20, -58, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(21, -58, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Counter eye glow
    if (glow) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(now / 100) * 0.2;
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(10, -56, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(20, -58, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawAntennae(col, now) {
    ctx.save();
    ctx.strokeStyle = col.base;
    ctx.lineWidth = 1.5;
    var sway = Math.sin(now / 250) * 8;

    // Antenna 1
    ctx.beginPath();
    ctx.moveTo(22, -46);
    ctx.quadraticCurveTo(40 + sway, -70, 55 + sway * 1.5, -62);
    ctx.stroke();

    // Antenna 2
    ctx.beginPath();
    ctx.moveTo(20, -48);
    ctx.quadraticCurveTo(35 - sway * 0.5, -75, 50 - sway, -70);
    ctx.stroke();

    ctx.restore();
  }

  function drawClaws(col, mode, now, t) {
    // Upper claw (larger, primary)
    drawSingleClaw(col, mode, now, t, 28, -46, 1.0, true);
    // Lower claw (slightly smaller)
    drawSingleClaw(col, mode, now, t, 30, -22, 0.85, false);
  }

  function drawSingleClaw(col, mode, now, t, baseX, baseY, scale, isUpper) {
    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.scale(scale, scale);

    // Arm segment
    var armLen = 18;
    var armAngle = 0;
    var clawOpen = 0.25 + Math.sin(now / 400) * 0.08; // idle breathing

    switch (mode) {
      case 'idle':
        armAngle = isUpper ? -0.3 : 0.2;
        break;
      case 'forward':
        armAngle = isUpper ? -0.1 : 0.3;
        clawOpen = 0.2;
        break;
      case 'backward':
        armAngle = isUpper ? -0.5 : 0.0;
        clawOpen = 0.1;
        break;
      case 'guard':
        armAngle = isUpper ? 0.4 : -0.4;
        clawOpen = 0.05;
        break;
      case 'light':
        armAngle = isUpper ? 0.3 : 0.1;
        armLen = isUpper ? 26 : 18;
        clawOpen = isUpper ? 0.5 : 0.2;
        break;
      case 'heavy':
        armAngle = isUpper ? 0.4 : 0.4;
        armLen = 24;
        clawOpen = 0.6;
        break;
      case 'dash':
        armAngle = isUpper ? 0.2 : 0.15;
        armLen = isUpper ? 22 : 18;
        clawOpen = 0.3;
        break;
      case 'counter':
        armAngle = isUpper ? 0.1 : -0.1;
        clawOpen = 0.7;
        break;
      case 'special':
        armAngle = isUpper ? 0.5 : 0.5;
        armLen = 26;
        clawOpen = t < 0.2 ? 0.1 + Math.sin(now / 30) * 0.3 : 0.8;
        break;
    }

    ctx.rotate(armAngle);

    // Arm
    ctx.fillStyle = col.base;
    roundRect(0, -4, armLen, 8, 3);

    // Claw pincer (two halves)
    ctx.save();
    ctx.translate(armLen, 0);

    // Upper pincer half
    ctx.save();
    ctx.rotate(-clawOpen);
    ctx.fillStyle = col.clawInner;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(16, -6);
    ctx.quadraticCurveTo(20, -3, 16, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.shadow;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Lower pincer half
    ctx.save();
    ctx.rotate(clawOpen);
    ctx.fillStyle = col.clawInner;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(16, 6);
    ctx.quadraticCurveTo(20, 3, 16, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.shadow;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Special glow on claws
    if (mode === 'special') {
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(now / 60) * 0.3;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(8, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // end claw translate

    ctx.restore(); // end single claw
  }

  // --- Visual effects overlays ---

  function drawGuardShield(col, now) {
    ctx.save();
    ctx.globalAlpha = 0.2 + Math.sin(now / 120) * 0.1;
    ctx.strokeStyle = col.highlight;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(5, -30, 35, -Math.PI * 0.7, Math.PI * 0.7);
    ctx.stroke();

    ctx.globalAlpha = 0.1;
    ctx.fillStyle = col.highlight;
    ctx.beginPath();
    ctx.arc(5, -30, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCounterGlow(col, now) {
    ctx.save();
    var pulse = 0.15 + Math.sin(now / 80) * 0.1;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, -35, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSpecialAura(col, now) {
    ctx.save();
    ctx.globalAlpha = 0.15 + Math.sin(now / 50) * 0.1;
    var grd = ctx.createRadialGradient(0, -35, 5, 0, -35, 50);
    grd.addColorStop(0, '#fbbf24');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, -35, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAttackTrail(col, t) {
    ctx.save();
    for (var i = 1; i <= 3; i++) {
      ctx.globalAlpha = (0.15 / i) * (1 - t * 3);
      ctx.fillStyle = col.highlight;
      ctx.beginPath();
      ctx.ellipse(28 + i * 8, -46, 12, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDashAfterimage(col, t) {
    ctx.save();
    for (var i = 1; i <= 3; i++) {
      ctx.globalAlpha = (0.12 / i) * (1 - t * 3);
      ctx.fillStyle = col.base;
      ctx.beginPath();
      ctx.ellipse(-i * 15, -35, 28, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Utility ---

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }
})();
