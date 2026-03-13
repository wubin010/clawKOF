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

  let targetState = null;
  const anim = {
    aPos: 25,
    bPos: 75,
    aHp: 100,
    bHp: 100,
    flashA: 0,
    flashB: 0,
  };

  init().catch((err) => {
    console.error(err);
  });

  async function init() {
    await refreshState();
    connectEvents();
    requestAnimationFrame(loop);
  }

  async function refreshState() {
    const response = await fetch(`/api/matches/${matchId}/state`);
    if (!response.ok) {
      throw new Error(`state fetch failed (${response.status})`);
    }
    const state = await response.json();
    applyState(state);
  }

  function connectEvents() {
    const es = new EventSource(`/api/matches/${matchId}/events`);
    const consume = (event) => {
      try {
        const parsed = JSON.parse(event.data);
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

    es.onerror = async () => {
      es.close();
      setTimeout(connectEvents, 2000);
      try {
        await refreshState();
      } catch {
        // ignore transient reconnect errors
      }
    };
  }

  function applyState(state) {
    if (targetState && targetState.fighters && state.fighters) {
      if (state.fighters[0].hp < targetState.fighters[0].hp) {
        anim.flashA = 1;
      }
      if (state.fighters[1].hp < targetState.fighters[1].hp) {
        anim.flashB = 1;
      }
    }

    targetState = state;

    const a = state.fighters[0];
    const b = state.fighters[1];

    els.meta.textContent = `Match ${state.id} | Referee ${state.refereeName}`;
    els.time.textContent = String(state.timeRemaining);
    els.status.textContent = state.status;
    els.distance.textContent = state.distance.toFixed(1);
    els.tick.textContent = String(state.tick);

    els.aName.textContent = `${a.slot}: ${a.name}`;
    els.bName.textContent = `${b.slot}: ${b.name}`;
    els.aHp.textContent = String(Math.round(a.hp));
    els.bHp.textContent = String(Math.round(b.hp));
    els.aEnergy.textContent = String(Math.round(a.energy));
    els.bEnergy.textContent = String(Math.round(b.energy));
    els.aAction.textContent = a.currentAction;
    els.bAction.textContent = b.currentAction;

    els.aHpBar.style.width = `${Math.max(0, a.hp)}%`;
    els.bHpBar.style.width = `${Math.max(0, b.hp)}%`;
    els.aEnBar.style.width = `${Math.max(0, a.energy)}%`;
    els.bEnBar.style.width = `${Math.max(0, b.energy)}%`;

    syncLog(state.recentEvents || []);

    if (state.status === 'finished') {
      els.result.classList.remove('hidden');
      els.summary.textContent = state.summary || 'Match over.';
      els.reportLink.href = `/api/matches/${state.id}/report`;
    } else {
      els.result.classList.add('hidden');
    }
  }

  function syncLog(events) {
    const items = events.slice(-12).map((event) => {
      const li = document.createElement('li');
      li.textContent = `[${event.tick}] ${event.message}`;
      return li;
    });

    els.log.innerHTML = '';
    for (const item of items) {
      els.log.appendChild(item);
    }
  }

  function loop() {
    if (targetState) {
      const a = targetState.fighters[0];
      const b = targetState.fighters[1];

      anim.aPos += (a.position - anim.aPos) * 0.13;
      anim.bPos += (b.position - anim.bPos) * 0.13;
      anim.aHp += (a.hp - anim.aHp) * 0.2;
      anim.bHp += (b.hp - anim.bHp) * 0.2;

      anim.flashA *= 0.88;
      anim.flashB *= 0.88;

      renderArena(a.currentAction, b.currentAction);
    }

    requestAnimationFrame(loop);
  }

  function renderArena(actionA, actionB) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    drawBackground(w, h);
    drawFighter(0.5 + anim.aPos / 100, 0.72, '#f97316', true, actionA, anim.flashA);
    drawFighter(0.5 + anim.bPos / 100, 0.72, '#38bdf8', false, actionB, anim.flashB);
  }

  function drawBackground(w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    for (let i = 0; i < 5; i += 1) {
      const x = (i + 0.5) * (w / 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.moveTo(x, h * 0.76);
      ctx.lineTo(x, h * 0.97);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFighter(nx, ny, color, facingRight, action, flash) {
    const w = canvas.width;
    const h = canvas.height;
    const x = nx * w - w / 2;
    const y = ny * h;

    const bob = Math.sin(Date.now() / 140) * 3;
    const pulse = 1 + Math.sin(Date.now() / 200 + x * 0.03) * 0.015;

    const attackBoost = action.includes('attack') ? 9 : 0;
    const guardShift = action === 'guard' ? -4 : 0;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(facingRight ? pulse : -pulse, pulse);

    if (flash > 0.05) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.7, flash)})`;
      ctx.beginPath();
      ctx.arc(0, -40, 36, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, -38 + guardShift, 34, 28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(12, -47, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(24, -45);
    ctx.lineTo(48 + attackBoost, -65);
    ctx.lineTo(43 + attackBoost, -34);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(18, -24);
    ctx.lineTo(40 + Math.max(0, attackBoost - 3), -8);
    ctx.lineTo(34 + Math.max(0, attackBoost - 3), -28);
    ctx.closePath();
    ctx.fill();

    ctx.fillRect(-26, -6, 10, 18);
    ctx.fillRect(-4, -2, 10, 14);

    ctx.restore();
  }
})();
