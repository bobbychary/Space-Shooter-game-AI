<<<<<<< HEAD
(() => {
  'use strict';

  // Canvas setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: true });

  // UI elements
  const elScore = document.getElementById('score');
  const elBest = document.getElementById('best');
  const elWave = document.getElementById('wave');
  const elHealthFill = document.getElementById('health-fill');

  const overlay = document.getElementById('overlay');
  const gameover = document.getElementById('gameover');
  const playBtn = document.getElementById('playBtn');
  const restartBtn = document.getElementById('restartBtn');
  const finalScore = document.getElementById('finalScore');
  const finalBest = document.getElementById('finalBest');

  // State
  let W = 0, H = 0, DPR = 1;
  let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'gameover'
  let lastT = 0;
  let accum = 0;

  // Input
  const input = {
    keys: Object.create(null),
    mouse: { x: 0, y: 0, down: false }
  };

  // Game objects
  let player;
  const bullets = [];
  const enemies = [];
  const enemyBullets = [];
  const particles = [];
  let stars = [];

  // Progression/score
  let score = 0;
  let best = Number(localStorage.getItem('horizon-best') || 0);
  let wave = 1;
  let spawnQueue = 0;
  let spawnTimer = 0;

  // Power-ups
  const powerUps = [];
  let killsSinceLastDrop = 0;
  let nextDropAt = Math.floor(rand(15, 21)); // 15-20 kills

  // FX
  let hitFlash = 0; // 0..1
  let shake = 0; // camera shake
  let vignettePulse = 0;

  // Constants (tunable)
  const COLORS = {
    ship: '#31ffa1',
    ship2: '#6cf2ff',
    enemy: '#7a5cff',
    enemy2: '#ff3d81',
    bullet: '#6cf2ff',
    ebullet: '#ff5c6c',
    white: '#e6f0ff',
    shield: '#31ffa1',
    health: '#fffd7a'
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    return dx * dx + dy * dy;
  };
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const rand = (a = 1, b) => {
    if (b === undefined) return Math.random() * a;
    return a + Math.random() * (b - a);
  };
  const randSign = () => (Math.random() < 0.5 ? -1 : 1);
  const fromAngle = (ang, mag = 1) => ({ x: Math.cos(ang) * mag, y: Math.sin(ang) * mag });

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // regenerate stars if empty or on resize
    if (!stars.length) {
      stars = genStars(180);
    } else {
      // adjust bounds but keep stars array
      for (const s of stars) {
        s.x = (s.x / s._w) * W;
        s.y = (s.y / s._h) * H;
        s._w = W; s._h = H;
      }
    }
  }
  window.addEventListener('resize', resize);

  // Starfield
  function genStars(n) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: Math.random() * 1 + 0.2, // depth 0.2..1.2
        s: Math.random() * 1.2 + 0.2, // size
        tw: Math.random() * Math.PI * 2, // twinkle phase
        _w: W, _h: H,
      });
    }
    return arr;
  }

  function updateStars(dt) {
    for (const s of stars) {
      s.y += (20 * (1.6 - s.z)) * dt; // slower for farther (bigger z => slower movement)
      if (s.y > H + 2) {
        s.y = -2;
        s.x = Math.random() * W;
      }
      s.tw += dt * rand(0.8, 2.0);
    }
  }

  function drawStars() {
    ctx.save();
    for (const s of stars) {
      const alpha = 0.2 + Math.abs(Math.sin(s.tw)) * 0.6;
      ctx.fillStyle = `rgba(230,240,255,${alpha * (1.2 - s.z)})`;
      ctx.shadowBlur = 8 * (1.4 - s.z);
      ctx.shadowColor = '#bfe9ff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.restore();
  }

  // Player
  function makePlayer() {
    return {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      angle: 0,
      speed: 420,
      accel: 1800,
      friction: 0.9,
      radius: 16,
      maxHealth: 100,
      health: 100,
      fireCD: 0,
      fireRPS: 12, // rounds per second
      alive: true,
      shieldActive: false,
      shieldTime: 0
    };
  }

  function updatePlayer(dt) {
    // Aim to mouse
    player.angle = Math.atan2(input.mouse.y - player.y, input.mouse.x - player.x);

    // Move with WASD
    const k = input.keys;
    let ax = 0, ay = 0;
    if (k['w'] || k['arrowup']) ay -= 1;
    if (k['s'] || k['arrowdown']) ay += 1;
    if (k['a'] || k['arrowleft']) ax -= 1;
    if (k['d'] || k['arrowright']) ax += 1;

    // Normalize diag
    if (ax !== 0 || ay !== 0) {
      const inv = 1 / Math.hypot(ax, ay);
      ax *= inv; ay *= inv;
    }

    player.vx += ax * player.accel * dt;
    player.vy += ay * player.accel * dt;

    // Cap speed softly
    const vmag = Math.hypot(player.vx, player.vy);
    const maxV = player.speed;
    if (vmag > maxV) {
      const s = maxV / vmag;
      player.vx *= s;
      player.vy *= s;
    }

    // Integrate
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Friction
    player.vx *= Math.pow(player.friction, dt * 60);
    player.vy *= Math.pow(player.friction, dt * 60);

    // Bounds
    const pad = 18;
    if (player.x < pad) { player.x = pad; player.vx *= -0.4; }
    if (player.y < pad) { player.y = pad; player.vy *= -0.4; }
    if (player.x > W - pad) { player.x = W - pad; player.vx *= -0.4; }
    if (player.y > H - pad) { player.y = H - pad; player.vy *= -0.4; }

    // Shooting on left button hold (drag to aim)
    player.fireCD -= dt;
    if (input.mouse.down && player.fireCD <= 0) {
      const delay = 1 / player.fireRPS;
      // spawn enough bullets to catch up if dt big
      while (player.fireCD <= 0) {
        shootPlayerBullet();
        player.fireCD += delay;
      }
    }

    // Thruster particles when moving
    if (vmag > 40) {
      const back = fromAngle(player.angle + Math.PI, 1);
      spawnParticle(player.x + back.x * 10, player.y + back.y * 10,
        (Math.random() - 0.5) * 40 - back.x * 60, (Math.random() - 0.5) * 40 - back.y * 60,
        rand(5, 9), 0.25, COLORS.ship2, 0.6);
    }
  }

  function drawPlayer() {
    if (!player.alive) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    // Active shield aura
    if (player.shieldActive) {
      const t = (performance.now() % 1000) / 1000;
      const puls = 6 + Math.sin(t * Math.PI * 2) * 2;
      ctx.save();
      ctx.shadowColor = COLORS.shield;
      ctx.shadowBlur = 24;
      ctx.strokeStyle = COLORS.shield;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 8 + puls * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Glow
    ctx.shadowColor = COLORS.ship2;
    ctx.shadowBlur = 18;

    // Ship core
    ctx.beginPath();
    // Triangle ship
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -10);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, 10);
    ctx.closePath();

    const grad = ctx.createLinearGradient(-12, 0, 20, 0);
    grad.addColorStop(0, COLORS.ship);
    grad.addColorStop(1, COLORS.ship2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outline
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#bffcff';
    ctx.stroke();

    // Nose glow
    ctx.beginPath();
    ctx.arc(20, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ship2;
    ctx.shadowBlur = 24;
    ctx.fill();

    ctx.restore();
  }

  // Bullets
  function shootPlayerBullet() {
    const spread = 0.02;
    const ang = player.angle + (Math.random() - 0.5) * spread;
    const dir = fromAngle(ang, 1);
    const speed = 900;
    const bx = player.x + dir.x * 18;
    const by = player.y + dir.y * 18;
    bullets.push({
      x: bx, y: by,
      vx: dir.x * speed,
      vy: dir.y * speed,
      r: 3.5,
      life: 1.2,
      dmg: 1
    });

    // muzzle flash particles
    spawnParticle(bx, by, dir.x * 40, dir.y * 40, rand(2, 4), 0.15, COLORS.bullet, 0.9);
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        bullets.splice(i, 1);
      }
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.shadowColor = COLORS.bullet;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLORS.bullet;
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Enemy bullets
  function spawnEnemyBullet(x, y, ang, speed = 420) {
    const dir = fromAngle(ang, 1);
    enemyBullets.push({
      x, y,
      vx: dir.x * speed,
      vy: dir.y * speed,
      r: 4,
      life: 3.0,
      dmg: 15
    });
  }

  function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) {
        enemyBullets.splice(i, 1);
      }
    }
  }

  function drawEnemyBullets() {
    ctx.save();
    ctx.shadowColor = COLORS.ebullet;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.ebullet;
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Enemies
  function spawnEnemy() {
    // spawn outside of screen edges
    const margin = 40;
    let x, y;
    if (Math.random() < 0.5) {
      x = Math.random() < 0.5 ? -margin : W + margin;
      y = Math.random() * H;
    } else {
      x = Math.random() * W;
      y = Math.random() < 0.5 ? -margin : H + margin;
    }

    const type = Math.random() < Math.min(0.25 + wave * 0.03, 0.6) ? 'shooter' : 'chaser';
    const baseHP = type === 'chaser' ? 3 : 5;
    const hp = Math.round(baseHP + wave * (type === 'chaser' ? 0.6 : 0.9));
    const speed = (type === 'chaser' ? 95 : 70) + wave * (type === 'chaser' ? 6 : 4);
    const r = type === 'chaser' ? rand(14, 20) : rand(16, 24);
    const e = {
      type,
      x, y,
      vx: 0, vy: 0,
      r,
      speed,
      hp,
      fireCD: rand(0.6, 1.6),
      rot: rand(0, Math.PI * 2),
    };
    enemies.push(e);
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.rot += dt * 0.6;

      const angToPlayer = Math.atan2(player.y - e.y, player.x - e.x);

      if (e.type === 'chaser') {
        const dir = fromAngle(angToPlayer, 1);
        e.vx = lerp(e.vx, dir.x * e.speed, 0.08);
        e.vy = lerp(e.vy, dir.y * e.speed, 0.08);
      } else { // shooter
        const d = dist(e.x, e.y, player.x, player.y);
        const ideal = 360; // keep some distance
        let dirMul = d > ideal ? 1 : -0.7;
        const dir = fromAngle(angToPlayer, dirMul);
        e.vx = lerp(e.vx, dir.x * e.speed * 0.8, 0.06);
        e.vy = lerp(e.vy, dir.y * e.speed * 0.8, 0.06);

        // shooting
        e.fireCD -= dt;
        const canShoot = e.fireCD <= 0 && d < 700;
        if (canShoot) {
          e.fireCD = Math.max(0.65 - wave * 0.01, 0.25) + Math.random() * 0.2;
          spawnEnemyBullet(e.x, e.y, angToPlayer, 360 + wave * 6);
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // keep on bounds roughly (bounce)
      const pad = -20;
      if (e.x < pad) { e.x = pad; e.vx *= -0.6; }
      if (e.y < pad) { e.y = pad; e.vy *= -0.6; }
      if (e.x > W - pad) { e.x = W - pad; e.vx *= -0.6; }
      if (e.y > H - pad) { e.y = H - pad; e.vy *= -0.6; }
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rot);

      // glow
      ctx.shadowColor = e.type === 'chaser' ? COLORS.enemy : COLORS.enemy2;
      ctx.shadowBlur = 18;

      // body
      ctx.beginPath();
      if (e.type === 'chaser') {
        ctx.moveTo(e.r, 0);
        ctx.lineTo(-e.r * 0.6, -e.r * 0.7);
        ctx.lineTo(-e.r * 0.2, 0);
        ctx.lineTo(-e.r * 0.6, e.r * 0.7);
      } else {
        ctx.arc(0, 0, e.r * 0.9, 0, Math.PI * 2);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(-e.r, -e.r, e.r, e.r);
      if (e.type === 'chaser') {
        grad.addColorStop(0, COLORS.enemy);
        grad.addColorStop(1, COLORS.enemy2);
      } else {
        grad.addColorStop(0, COLORS.enemy2);
        grad.addColorStop(1, COLORS.enemy);
      }
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e8ddff';
      ctx.stroke();

      ctx.restore();

      // small health ring
      const hpPct = clamp(e.hp / Math.max(1, (e.type === 'chaser' ? 3 : 5) + wave), 0, 1);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = COLORS.white;
      ctx.shadowColor = COLORS.white;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Particles
  function spawnParticle(x, y, vx, vy, size, life, color, glow = 0.6) {
    particles.push({ x, y, vx, vy, size, life, maxLife: life, color, glow });
  }

  function burst(x, y, colorA, colorB, count = 18, speed = 220) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const mag = rand(0.4, 1) * speed;
      spawnParticle(
        x, y,
        Math.cos(ang) * mag,
        Math.sin(ang) * mag,
        rand(2, 6),
        rand(0.4, 0.9),
        Math.random() < 0.5 ? colorA : colorB,
        0.9
      );
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // Power-up helpers
  function spawnPowerUp(x, y) {
    const type = Math.random() < 0.5 ? 'shield' : 'health';
    powerUps.push({
      type,
      x, y,
      r: 12,
      vx: rand(-40, 40),
      vy: rand(-40, 40),
      rot: rand(0, Math.PI * 2),
      life: 12 // seconds before expiry
    });
  }

  function updatePowerUps(dt) {
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.rot += dt * 1.5;
      p.life -= dt;
      // keep inside screen
      p.x = clamp(p.x, 16, W - 16);
      p.y = clamp(p.y, 16, H - 16);
      if (p.life <= 0) powerUps.splice(i, 1);
    }
  }

  function drawPowerUps() {
    ctx.save();
    for (const p of powerUps) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.shadowBlur = 14;
      if (p.type === 'shield') {
        ctx.shadowColor = COLORS.shield;
        ctx.strokeStyle = COLORS.shield;
      } else {
        ctx.shadowColor = COLORS.health;
        ctx.strokeStyle = COLORS.health;
      }
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      if (p.type === 'shield') {
        // hexagon token
        const r = p.r;
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      } else {
        // plus token
        const s = p.r;
        ctx.moveTo(-s * 0.5, -s * 1.2); ctx.lineTo(s * 0.5, -s * 1.2);
        ctx.moveTo(0, -s * 1.2); ctx.lineTo(0, s * 1.2);
        ctx.moveTo(-s * 1.2, -s * 0.5); ctx.lineTo(-s * 1.2, s * 0.5);
        ctx.moveTo(s * 1.2, -s * 0.5); ctx.lineTo(s * 1.2, s * 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12 * p.glow * (0.5 + 0.5 * a);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Collisions
  function handleCollisions() {
    // bullet -> enemy
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const r = e.r + b.r;
        if (dist2(e.x, e.y, b.x, b.y) <= r * r) {
          e.hp -= b.dmg;
          bullets.splice(j, 1);

          spawnParticle(b.x, b.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, rand(2, 4), 0.25, COLORS.bullet, 0.8);

          if (e.hp <= 0) {
            // kill enemy
            burst(e.x, e.y, COLORS.enemy, COLORS.enemy2, 24, 260);
            enemies.splice(i, 1);
            addScore(10 + Math.round(wave * 2.5));
            // track kills and decide power-up drop
            killsSinceLastDrop++;
            if (killsSinceLastDrop >= nextDropAt) {
              spawnPowerUp(e.x, e.y);
              killsSinceLastDrop = 0;
              nextDropAt = Math.floor(rand(15, 21));
            }
            vignettePulse = 1.0;
            shake = Math.min(shake + 8, 16);
            break;
          } else {
            // minor burst on hit
            burst(e.x, e.y, COLORS.enemy, COLORS.enemy2, 8, 160);
          }
        }
      }
    }

    // enemy -> player
    if (player.alive) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const r = e.r + player.radius;
        if (dist2(e.x, e.y, player.x, player.y) <= r * r) {
          // impact
          const dmg = e.type === 'chaser' ? 16 : 22;
          if (player.shieldActive) {
            // absorb and shatter shield
            player.shieldActive = false;
            player.shieldTime = 0;
            burst(player.x, player.y, COLORS.shield, COLORS.ship2, 28, 300);
          } else {
            damagePlayer(dmg);
          }
          // push enemy slightly away
          const ang = Math.atan2(e.y - player.y, e.x - player.x);
          const dir = fromAngle(ang, 1);
          e.vx += dir.x * 220;
          e.vy += dir.y * 220;

          // enemy also takes damage on ram
          e.hp -= 2;
          if (e.hp <= 0) {
            burst(e.x, e.y, COLORS.enemy, COLORS.enemy2, 18, 240);
            enemies.splice(i, 1);
            addScore(10 + Math.round(wave * 2.5));
          }
        }
      }
    }

    // enemy bullet -> player
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      const r = b.r + player.radius;
      if (dist2(b.x, b.y, player.x, player.y) <= r * r) {
        enemyBullets.splice(i, 1);
        if (player.shieldActive) {
          // absorb projectile, reduce shield time slightly
          player.shieldTime = Math.max(0, player.shieldTime - 0.5);
          if (player.shieldTime <= 0) {
            player.shieldActive = false;
          }
          burst(player.x, player.y, COLORS.shield, COLORS.ship2, 16, 240);
        } else {
          damagePlayer(b.dmg);
        }
        spawnParticle(b.x, b.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, rand(2, 4), 0.25, COLORS.ebullet, 0.9);
      }
    }

    // power-up -> player
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      const r = p.r + player.radius;
      if (dist2(p.x, p.y, player.x, player.y) <= r * r) {
        if (p.type === 'shield') {
          player.shieldActive = true;
          player.shieldTime = 5.0; // 5 seconds
          burst(player.x, player.y, COLORS.shield, COLORS.ship2, 24, 280);
        } else if (p.type === 'health') {
          const before = player.health;
          player.health = Math.min(player.maxHealth, player.health + 20);
          if (player.health > before) {
            burst(player.x, player.y, COLORS.health, COLORS.ship2, 16, 220);
          }
        }
        powerUps.splice(i, 1);
      }
    }
  }

  function damagePlayer(dmg) {
    if (!player.alive) return;
    if (player.shieldActive) return; // safety
    player.health -= dmg;
    shake = Math.min(shake + 10, 20);
    hitFlash = 0.35;
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      burst(player.x, player.y, COLORS.ship, COLORS.ship2, 40, 300);
      endGame();
    }
  }

  function addScore(v) {
    score += v;
    if (score > best) {
      best = score;
      localStorage.setItem('horizon-best', String(best));
    }
  }

  // Waves
  function initWave(n) {
    wave = n;
    elWave.textContent = String(wave);
    spawnQueue = 6 + Math.round(wave * 2.2);
    spawnTimer = 0.1;
    // small heal each wave
    player.health = Math.min(player.maxHealth, player.health + 12);
  }

  function updateWave(dt) {
    if (spawnQueue > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = Math.max(0.16, 0.6 - wave * 0.03);
        spawnEnemy();
        spawnQueue--;
      }
    } else {
      // next wave when field is clear
      if (enemies.length === 0 && enemyBullets.length === 0) {
        initWave(wave + 1);
      }
    }
  }

  // UI updates
  function updateHUD() {
    elScore.textContent = String(score);
    elBest.textContent = String(best);
    elWave.textContent = String(wave);
    const pct = (player.health / player.maxHealth) * 100;
    elHealthFill.style.width = `${clamp(pct, 0, 100)}%`;
  }

  // Render helpers
  function pushCamera() {
    ctx.save();
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    ctx.translate(sx, sy);
    shake = Math.max(0, shake - 0.9);
  }
  function popCamera() {
    ctx.restore();
  }

  function drawVignette() {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    const pulse = Math.max(0, vignettePulse);
    g.addColorStop(0, `rgba(0,0,0,0)`);
    g.addColorStop(1, `rgba(0,0,0,${0.35 + pulse * 0.2})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    vignettePulse = Math.max(0, vignettePulse - 0.03);
    ctx.restore();
  }

  function drawHitFlash() {
    if (hitFlash <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(255,92,108,${hitFlash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    hitFlash = Math.max(0, hitFlash - 0.02);
  }

  function drawCrosshair() {
    ctx.save();
    ctx.translate(input.mouse.x, input.mouse.y);
    ctx.shadowColor = COLORS.white;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = COLORS.white;
    ctx.globalAlpha = input.mouse.down ? 1 : 0.7;
    ctx.lineWidth = 1.5;
    const r = 10;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r - 4, 0); ctx.lineTo(-r + 2, 0);
    ctx.moveTo(r - 2, 0); ctx.lineTo(r + 4, 0);
    ctx.moveTo(0, -r - 4); ctx.lineTo(0, -r + 2);
    ctx.moveTo(0, r - 2); ctx.lineTo(0, r + 4);
    ctx.stroke();
    ctx.restore();
  }

  // Game lifecycle
  function resetGame() {
    bullets.length = 0;
    enemies.length = 0;
    enemyBullets.length = 0;
    particles.length = 0;
    score = 0;
    player = makePlayer();
    initWave(1);
    updateHUD();
  }

  function startGame() {
    overlay.classList.add('hidden');
    gameover.classList.add('hidden');
    state = 'playing';
    resetGame();
  }

  function endGame() {
    state = 'gameover';
    finalScore.textContent = String(score);
    finalBest.textContent = String(best);
    gameover.classList.remove('hidden');
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      // reuse overlay as Pause screen
      try {
        const h1 = overlay.querySelector('h1');
        const tagline = overlay.querySelector('.tagline');
        const btn = overlay.querySelector('#playBtn');
        if (h1) h1.textContent = 'Paused';
        if (tagline) tagline.textContent = 'Press P to Resume';
        if (btn) btn.textContent = 'Resume';
      } catch {}
      overlay.classList.remove('hidden');
    } else if (state === 'paused') {
      overlay.classList.add('hidden');
      state = 'playing';
      // restore button text
      try {
        const h1 = overlay.querySelector('h1');
        const tagline = overlay.querySelector('.tagline');
        const btn = overlay.querySelector('#playBtn');
        if (h1) h1.textContent = 'Horizon';
        if (tagline) tagline.textContent = 'Neon Space Shooter';
        if (btn) btn.textContent = 'Play';
      } catch {}
    }
  }

  // Input handlers
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = true;

    // Start/resume with Space or Enter
    if (key === ' ' || key === 'enter') {
      e.preventDefault();
      if (state === 'menu') startGame();
      else if (state === 'paused') togglePause();
    }

    if (key === 'p') {
      e.preventDefault();
      if (state === 'playing' || state === 'paused') togglePause();
    }
    if (key === 'r') {
      e.preventDefault();
      if (state === 'gameover') {
        restartGame();
      } else if (state === 'playing' || state === 'paused') {
        // restart instantly
        startGame();
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = false;
  });

  function updateMouseFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = (e.clientX - rect.left);
    input.mouse.y = (e.clientY - rect.top);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      updateMouseFromEvent(e);
      input.mouse.down = true;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (state === 'menu') startGame();
      if (state === 'paused') togglePause();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    updateMouseFromEvent(e);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0) {
      input.mouse.down = false;
      canvas.releasePointerCapture(e.pointerId);
    }
  });

  // Buttons
  function restartGame() {
    gameover.classList.add('hidden');
    startGame();
  }
  if (playBtn) playBtn.addEventListener('click', () => {
    if (state === 'menu' || state === 'paused') startGame();
  });
  if (overlay) overlay.addEventListener('click', (e) => {
    if (state === 'menu') startGame();
    else if (state === 'paused') togglePause();
  });
  if (restartBtn) restartBtn.addEventListener('click', restartGame);

  // Main loop
  function frame(t) {
    const sec = t / 1000;
    let dt = sec - lastT;
    if (!isFinite(dt) || dt < 0) dt = 0;
    lastT = sec;
    // clamp dt to avoid spiral-of-death after tab hidden
    dt = Math.min(dt, 1 / 30);

    // Update
    updateStars(dt);

    if (state === 'playing') {
      updatePlayer(dt);
      updateBullets(dt);
      updateEnemyBullets(dt);
      updateEnemies(dt);
      updatePowerUps(dt);
      // shield countdown
      if (player.shieldActive) {
        player.shieldTime -= dt;
        if (player.shieldTime <= 0) {
          player.shieldActive = false;
          player.shieldTime = 0;
        }
      }
      handleCollisions();
      updateParticles(dt);
      updateWave(dt);
      updateHUD();
    } else {
      // even when paused/menu/gameover, particles/stars can animate slightly for life
      updateParticles(dt * (state === 'paused' ? 0.25 : 0.5));
    }

    // Draw
    ctx.clearRect(0, 0, W, H);

    pushCamera();
    drawStars();
    drawParticles();
    if (state !== 'menu') drawEnemies();
    if (state !== 'menu') drawEnemyBullets();
    if (state !== 'menu') drawBullets();
    if (state !== 'menu') drawPowerUps();
    if (player) drawPlayer();
    popCamera();

    drawVignette();
    drawHitFlash();
    drawCrosshair();

    requestAnimationFrame(frame);
  }

  // Initialize
  resize();
  best = Number(localStorage.getItem('horizon-best') || 0);
  elBest.textContent = String(best);
  // center mouse initial
  input.mouse.x = W / 2; input.mouse.y = H / 2;

  // start loop in menu
  requestAnimationFrame(frame);

})();
=======
(() => {
  'use strict';

  // Canvas setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: true });

  // UI elements
  const elScore = document.getElementById('score');
  const elBest = document.getElementById('best');
  const elWave = document.getElementById('wave');
  const elHealthFill = document.getElementById('health-fill');

  const overlay = document.getElementById('overlay');
  const gameover = document.getElementById('gameover');
  const playBtn = document.getElementById('playBtn');
  const restartBtn = document.getElementById('restartBtn');
  const finalScore = document.getElementById('finalScore');
  const finalBest = document.getElementById('finalBest');

  // State
  let W = 0, H = 0, DPR = 1;
  let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'gameover'
  let lastT = 0;
  let accum = 0;

  // Input
  const input = {
    keys: Object.create(null),
    mouse: { x: 0, y: 0, down: false }
  };

  // Game objects
  let player;
  const bullets = [];
  const enemies = [];
  const enemyBullets = [];
  const particles = [];
  let stars = [];

  // Progression/score
  let score = 0;
  let best = Number(localStorage.getItem('horizon-best') || 0);
  let wave = 1;
  let spawnQueue = 0;
  let spawnTimer = 0;

  // FX
  let hitFlash = 0; // 0..1
  let shake = 0; // camera shake
  let vignettePulse = 0;

  // Constants (tunable)
  const COLORS = {
    ship: '#31ffa1',
    ship2: '#6cf2ff',
    enemy: '#7a5cff',
    enemy2: '#ff3d81',
    bullet: '#6cf2ff',
    ebullet: '#ff5c6c',
    white: '#e6f0ff'
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    return dx * dx + dy * dy;
  };
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const rand = (a = 1, b) => {
    if (b === undefined) return Math.random() * a;
    return a + Math.random() * (b - a);
  };
  const randSign = () => (Math.random() < 0.5 ? -1 : 1);
  const fromAngle = (ang, mag = 1) => ({ x: Math.cos(ang) * mag, y: Math.sin(ang) * mag });

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // regenerate stars if empty or on resize
    if (!stars.length) {
      stars = genStars(180);
    } else {
      // adjust bounds but keep stars array
      for (const s of stars) {
        s.x = (s.x / s._w) * W;
        s.y = (s.y / s._h) * H;
        s._w = W; s._h = H;
      }
    }
  }
  window.addEventListener('resize', resize);

  // Starfield
  function genStars(n) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: Math.random() * 1 + 0.2, // depth 0.2..1.2
        s: Math.random() * 1.2 + 0.2, // size
        tw: Math.random() * Math.PI * 2, // twinkle phase
        _w: W, _h: H,
      });
    }
    return arr;
  }

  function updateStars(dt) {
    for (const s of stars) {
      s.y += (20 * (1.6 - s.z)) * dt; // slower for farther (bigger z => slower movement)
      if (s.y > H + 2) {
        s.y = -2;
        s.x = Math.random() * W;
      }
      s.tw += dt * rand(0.8, 2.0);
    }
  }

  function drawStars() {
    ctx.save();
    for (const s of stars) {
      const alpha = 0.2 + Math.abs(Math.sin(s.tw)) * 0.6;
      ctx.fillStyle = `rgba(230,240,255,${alpha * (1.2 - s.z)})`;
      ctx.shadowBlur = 8 * (1.4 - s.z);
      ctx.shadowColor = '#bfe9ff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.restore();
  }

  // Player
  function makePlayer() {
    return {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      angle: 0,
      speed: 420,
      accel: 1800,
      friction: 0.9,
      radius: 16,
      maxHealth: 100,
      health: 100,
      fireCD: 0,
      fireRPS: 12, // rounds per second
      alive: true
    };
  }

  function updatePlayer(dt) {
    // Aim to mouse
    player.angle = Math.atan2(input.mouse.y - player.y, input.mouse.x - player.x);

    // Move with WASD
    const k = input.keys;
    let ax = 0, ay = 0;
    if (k['w'] || k['arrowup']) ay -= 1;
    if (k['s'] || k['arrowdown']) ay += 1;
    if (k['a'] || k['arrowleft']) ax -= 1;
    if (k['d'] || k['arrowright']) ax += 1;

    // Normalize diag
    if (ax !== 0 || ay !== 0) {
      const inv = 1 / Math.hypot(ax, ay);
      ax *= inv; ay *= inv;
    }

    player.vx += ax * player.accel * dt;
    player.vy += ay * player.accel * dt;

    // Cap speed softly
    const vmag = Math.hypot(player.vx, player.vy);
    const maxV = player.speed;
    if (vmag > maxV) {
      const s = maxV / vmag;
      player.vx *= s;
      player.vy *= s;
    }

    // Integrate
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Friction
    player.vx *= Math.pow(player.friction, dt * 60);
    player.vy *= Math.pow(player.friction, dt * 60);

    // Bounds
    const pad = 18;
    if (player.x < pad) { player.x = pad; player.vx *= -0.4; }
    if (player.y < pad) { player.y = pad; player.vy *= -0.4; }
    if (player.x > W - pad) { player.x = W - pad; player.vx *= -0.4; }
    if (player.y > H - pad) { player.y = H - pad; player.vy *= -0.4; }

    // Shooting on left button hold (drag to aim)
    player.fireCD -= dt;
    if (input.mouse.down && player.fireCD <= 0) {
      const delay = 1 / player.fireRPS;
      // spawn enough bullets to catch up if dt big
      while (player.fireCD <= 0) {
        shootPlayerBullet();
        player.fireCD += delay;
      }
    }

    // Thruster particles when moving
    if (vmag > 40) {
      const back = fromAngle(player.angle + Math.PI, 1);
      spawnParticle(player.x + back.x * 10, player.y + back.y * 10,
        (Math.random() - 0.5) * 40 - back.x * 60, (Math.random() - 0.5) * 40 - back.y * 60,
        rand(5, 9), 0.25, COLORS.ship2, 0.6);
    }
  }

  function drawPlayer() {
    if (!player.alive) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    // Glow
    ctx.shadowColor = COLORS.ship2;
    ctx.shadowBlur = 18;

    // Ship core
    ctx.beginPath();
    // Triangle ship
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -10);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, 10);
    ctx.closePath();

    const grad = ctx.createLinearGradient(-12, 0, 20, 0);
    grad.addColorStop(0, COLORS.ship);
    grad.addColorStop(1, COLORS.ship2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outline
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#bffcff';
    ctx.stroke();

    // Nose glow
    ctx.beginPath();
    ctx.arc(20, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ship2;
    ctx.shadowBlur = 24;
    ctx.fill();

    ctx.restore();
  }

  // Bullets
  function shootPlayerBullet() {
    const spread = 0.02;
    const ang = player.angle + (Math.random() - 0.5) * spread;
    const dir = fromAngle(ang, 1);
    const speed = 900;
    const bx = player.x + dir.x * 18;
    const by = player.y + dir.y * 18;
    bullets.push({
      x: bx, y: by,
      vx: dir.x * speed,
      vy: dir.y * speed,
      r: 3.5,
      life: 1.2,
      dmg: 1
    });

    // muzzle flash particles
    spawnParticle(bx, by, dir.x * 40, dir.y * 40, rand(2, 4), 0.15, COLORS.bullet, 0.9);
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        bullets.splice(i, 1);
      }
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.shadowColor = COLORS.bullet;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLORS.bullet;
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Enemy bullets
  function spawnEnemyBullet(x, y, ang, speed = 420) {
    const dir = fromAngle(ang, 1);
    enemyBullets.push({
      x, y,
      vx: dir.x * speed,
      vy: dir.y * speed,
      r: 4,
      life: 3.0,
      dmg: 15
    });
  }

  function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) {
        enemyBullets.splice(i, 1);
      }
    }
  }

  function drawEnemyBullets() {
    ctx.save();
    ctx.shadowColor = COLORS.ebullet;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.ebullet;
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Enemies
  function spawnEnemy() {
    // spawn outside of screen edges
    const margin = 40;
    let x, y;
    if (Math.random() < 0.5) {
      x = Math.random() < 0.5 ? -margin : W + margin;
      y = Math.random() * H;
    } else {
      x = Math.random() * W;
      y = Math.random() < 0.5 ? -margin : H + margin;
    }

    const type = Math.random() < Math.min(0.25 + wave * 0.03, 0.6) ? 'shooter' : 'chaser';
    const baseHP = type === 'chaser' ? 3 : 5;
    const hp = Math.round(baseHP + wave * (type === 'chaser' ? 0.6 : 0.9));
    const speed = (type === 'chaser' ? 95 : 70) + wave * (type === 'chaser' ? 6 : 4);
    const r = type === 'chaser' ? rand(14, 20) : rand(16, 24);
    const e = {
      type,
      x, y,
      vx: 0, vy: 0,
      r,
      speed,
      hp,
      fireCD: rand(0.6, 1.6),
      rot: rand(0, Math.PI * 2),
    };
    enemies.push(e);
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.rot += dt * 0.6;

      const angToPlayer = Math.atan2(player.y - e.y, player.x - e.x);

      if (e.type === 'chaser') {
        const dir = fromAngle(angToPlayer, 1);
        e.vx = lerp(e.vx, dir.x * e.speed, 0.08);
        e.vy = lerp(e.vy, dir.y * e.speed, 0.08);
      } else { // shooter
        const d = dist(e.x, e.y, player.x, player.y);
        const ideal = 360; // keep some distance
        let dirMul = d > ideal ? 1 : -0.7;
        const dir = fromAngle(angToPlayer, dirMul);
        e.vx = lerp(e.vx, dir.x * e.speed * 0.8, 0.06);
        e.vy = lerp(e.vy, dir.y * e.speed * 0.8, 0.06);

        // shooting
        e.fireCD -= dt;
        const canShoot = e.fireCD <= 0 && d < 700;
        if (canShoot) {
          e.fireCD = Math.max(0.65 - wave * 0.01, 0.25) + Math.random() * 0.2;
          spawnEnemyBullet(e.x, e.y, angToPlayer, 360 + wave * 6);
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // keep on bounds roughly (bounce)
      const pad = -20;
      if (e.x < pad) { e.x = pad; e.vx *= -0.6; }
      if (e.y < pad) { e.y = pad; e.vy *= -0.6; }
      if (e.x > W - pad) { e.x = W - pad; e.vx *= -0.6; }
      if (e.y > H - pad) { e.y = H - pad; e.vy *= -0.6; }
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rot);

      // glow
      ctx.shadowColor = e.type === 'chaser' ? COLORS.enemy : COLORS.enemy2;
      ctx.shadowBlur = 18;

      // body
      ctx.beginPath();
      if (e.type === 'chaser') {
        ctx.moveTo(e.r, 0);
        ctx.lineTo(-e.r * 0.6, -e.r * 0.7);
        ctx.lineTo(-e.r * 0.2, 0);
        ctx.lineTo(-e.r * 0.6, e.r * 0.7);
      } else {
        ctx.arc(0, 0, e.r * 0.9, 0, Math.PI * 2);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(-e.r, -e.r, e.r, e.r);
      if (e.type === 'chaser') {
        grad.addColorStop(0, COLORS.enemy);
        grad.addColorStop(1, COLORS.enemy2);
      } else {
        grad.addColorStop(0, COLORS.enemy2);
        grad.addColorStop(1, COLORS.enemy);
      }
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e8ddff';
      ctx.stroke();

      ctx.restore();

      // small health ring
      const hpPct = clamp(e.hp / Math.max(1, (e.type === 'chaser' ? 3 : 5) + wave), 0, 1);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = COLORS.white;
      ctx.shadowColor = COLORS.white;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Particles
  function spawnParticle(x, y, vx, vy, size, life, color, glow = 0.6) {
    particles.push({ x, y, vx, vy, size, life, maxLife: life, color, glow });
  }

  function burst(x, y, colorA, colorB, count = 18, speed = 220) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const mag = rand(0.4, 1) * speed;
      spawnParticle(
        x, y,
        Math.cos(ang) * mag,
        Math.sin(ang) * mag,
        rand(2, 6),
        rand(0.4, 0.9),
        Math.random() < 0.5 ? colorA : colorB,
        0.9
      );
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12 * p.glow * (0.5 + 0.5 * a);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Collisions
  function handleCollisions() {
    // bullet -> enemy
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const r = e.r + b.r;
        if (dist2(e.x, e.y, b.x, b.y) <= r * r) {
          e.hp -= b.dmg;
          bullets.splice(j, 1);

          spawnParticle(b.x, b.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, rand(2, 4), 0.25, COLORS.bullet, 0.8);

          if (e.hp <= 0) {
            // kill enemy
            burst(e.x, e.y, COLORS.enemy, COLORS.enemy2, 24, 260);
            enemies.splice(i, 1);
            addScore(10 + Math.round(wave * 2.5));
            vignettePulse = 1.0;
            shake = Math.min(shake + 8, 16);
            break;
          } else {
            // minor burst on hit
            burst(e.x, e.y, COLORS.enemy, COLORS.enemy2, 8, 160);
          }
        }
      }
    }

    // enemy -> player
    if (player.alive) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const r = e.r + player.radius;
        if (dist2(e.x, e.y, player.x, player.y) <= r * r) {
          // impact
          const dmg = e.type === 'chaser' ? 16 : 22;
          damagePlayer(dmg);
          // push enemy slightly away
          const ang = Math.atan2(e.y - player.y, e.x - player.x);
          const dir = fromAngle(ang, 1);
          e.vx += dir.x * 220;
          e.vy += dir.y * 220;

          // enemy also takes damage on ram
          e.hp -= 2;
          if (e.hp <= 0) {
            burst(e.x, e.y, COLORS.enemy, COLORS.enemy2, 18, 240);
            enemies.splice(i, 1);
            addScore(10 + Math.round(wave * 2.5));
          }
        }
      }
    }

    // enemy bullet -> player
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      const r = b.r + player.radius;
      if (dist2(b.x, b.y, player.x, player.y) <= r * r) {
        enemyBullets.splice(i, 1);
        damagePlayer(b.dmg);
        spawnParticle(b.x, b.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, rand(2, 4), 0.25, COLORS.ebullet, 0.9);
      }
    }
  }

  function damagePlayer(dmg) {
    if (!player.alive) return;
    player.health -= dmg;
    shake = Math.min(shake + 10, 20);
    hitFlash = 0.35;
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      burst(player.x, player.y, COLORS.ship, COLORS.ship2, 40, 300);
      endGame();
    }
  }

  function addScore(v) {
    score += v;
    if (score > best) {
      best = score;
      localStorage.setItem('horizon-best', String(best));
    }
  }

  // Waves
  function initWave(n) {
    wave = n;
    elWave.textContent = String(wave);
    spawnQueue = 6 + Math.round(wave * 2.2);
    spawnTimer = 0.1;
    // small heal each wave
    player.health = Math.min(player.maxHealth, player.health + 12);
  }

  function updateWave(dt) {
    if (spawnQueue > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = Math.max(0.16, 0.6 - wave * 0.03);
        spawnEnemy();
        spawnQueue--;
      }
    } else {
      // next wave when field is clear
      if (enemies.length === 0 && enemyBullets.length === 0) {
        initWave(wave + 1);
      }
    }
  }

  // UI updates
  function updateHUD() {
    elScore.textContent = String(score);
    elBest.textContent = String(best);
    elWave.textContent = String(wave);
    const pct = (player.health / player.maxHealth) * 100;
    elHealthFill.style.width = `${clamp(pct, 0, 100)}%`;
  }

  // Render helpers
  function pushCamera() {
    ctx.save();
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    ctx.translate(sx, sy);
    shake = Math.max(0, shake - 0.9);
  }
  function popCamera() {
    ctx.restore();
  }

  function drawVignette() {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    const pulse = Math.max(0, vignettePulse);
    g.addColorStop(0, `rgba(0,0,0,0)`);
    g.addColorStop(1, `rgba(0,0,0,${0.35 + pulse * 0.2})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    vignettePulse = Math.max(0, vignettePulse - 0.03);
    ctx.restore();
  }

  function drawHitFlash() {
    if (hitFlash <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(255,92,108,${hitFlash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    hitFlash = Math.max(0, hitFlash - 0.02);
  }

  function drawCrosshair() {
    ctx.save();
    ctx.translate(input.mouse.x, input.mouse.y);
    ctx.shadowColor = COLORS.white;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = COLORS.white;
    ctx.globalAlpha = input.mouse.down ? 1 : 0.7;
    ctx.lineWidth = 1.5;
    const r = 10;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r - 4, 0); ctx.lineTo(-r + 2, 0);
    ctx.moveTo(r - 2, 0); ctx.lineTo(r + 4, 0);
    ctx.moveTo(0, -r - 4); ctx.lineTo(0, -r + 2);
    ctx.moveTo(0, r - 2); ctx.lineTo(0, r + 4);
    ctx.stroke();
    ctx.restore();
  }

  // Game lifecycle
  function resetGame() {
    bullets.length = 0;
    enemies.length = 0;
    enemyBullets.length = 0;
    particles.length = 0;
    score = 0;
    player = makePlayer();
    initWave(1);
    updateHUD();
  }

  function startGame() {
    overlay.classList.add('hidden');
    gameover.classList.add('hidden');
    state = 'playing';
    resetGame();
  }

  function endGame() {
    state = 'gameover';
    finalScore.textContent = String(score);
    finalBest.textContent = String(best);
    gameover.classList.remove('hidden');
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      // reuse overlay as Pause screen
      try {
        const h1 = overlay.querySelector('h1');
        const tagline = overlay.querySelector('.tagline');
        const btn = overlay.querySelector('#playBtn');
        if (h1) h1.textContent = 'Paused';
        if (tagline) tagline.textContent = 'Press P to Resume';
        if (btn) btn.textContent = 'Resume';
      } catch {}
      overlay.classList.remove('hidden');
    } else if (state === 'paused') {
      overlay.classList.add('hidden');
      state = 'playing';
      // restore button text
      try {
        const h1 = overlay.querySelector('h1');
        const tagline = overlay.querySelector('.tagline');
        const btn = overlay.querySelector('#playBtn');
        if (h1) h1.textContent = 'Horizon';
        if (tagline) tagline.textContent = 'Neon Space Shooter';
        if (btn) btn.textContent = 'Play';
      } catch {}
    }
  }

  // Input handlers
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = true;

    // Start/resume with Space or Enter
    if (key === ' ' || key === 'enter') {
      e.preventDefault();
      if (state === 'menu') startGame();
      else if (state === 'paused') togglePause();
    }

    if (key === 'p') {
      e.preventDefault();
      if (state === 'playing' || state === 'paused') togglePause();
    }
    if (key === 'r') {
      e.preventDefault();
      if (state === 'gameover') {
        restartGame();
      } else if (state === 'playing' || state === 'paused') {
        // restart instantly
        startGame();
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    input.keys[key] = false;
  });

  function updateMouseFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = (e.clientX - rect.left);
    input.mouse.y = (e.clientY - rect.top);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      updateMouseFromEvent(e);
      input.mouse.down = true;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (state === 'menu') startGame();
      if (state === 'paused') togglePause();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    updateMouseFromEvent(e);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0) {
      input.mouse.down = false;
      canvas.releasePointerCapture(e.pointerId);
    }
  });

  // Buttons
  function restartGame() {
    gameover.classList.add('hidden');
    startGame();
  }
  if (playBtn) playBtn.addEventListener('click', () => {
    if (state === 'menu' || state === 'paused') startGame();
  });
  if (overlay) overlay.addEventListener('click', (e) => {
    if (state === 'menu') startGame();
    else if (state === 'paused') togglePause();
  });
  if (restartBtn) restartBtn.addEventListener('click', restartGame);

  // Main loop
  function frame(t) {
    const sec = t / 1000;
    let dt = sec - lastT;
    if (!isFinite(dt) || dt < 0) dt = 0;
    lastT = sec;
    // clamp dt to avoid spiral-of-death after tab hidden
    dt = Math.min(dt, 1 / 30);

    // Update
    updateStars(dt);

    if (state === 'playing') {
      updatePlayer(dt);
      updateBullets(dt);
      updateEnemyBullets(dt);
      updateEnemies(dt);
      handleCollisions();
      updateParticles(dt);
      updateWave(dt);
      updateHUD();
    } else {
      // even when paused/menu/gameover, particles/stars can animate slightly for life
      updateParticles(dt * (state === 'paused' ? 0.25 : 0.5));
    }

    // Draw
    ctx.clearRect(0, 0, W, H);

    pushCamera();
    drawStars();
    drawParticles();
    if (state !== 'menu') drawEnemies();
    if (state !== 'menu') drawEnemyBullets();
    if (state !== 'menu') drawBullets();
    if (player) drawPlayer();
    popCamera();

    drawVignette();
    drawHitFlash();
    drawCrosshair();

    requestAnimationFrame(frame);
  }

  // Initialize
  resize();
  best = Number(localStorage.getItem('horizon-best') || 0);
  elBest.textContent = String(best);
  // center mouse initial
  input.mouse.x = W / 2; input.mouse.y = H / 2;

  // start loop in menu
  requestAnimationFrame(frame);

})();
>>>>>>> 9829626dff6428467c6b0d856159b145d3d6b91b
