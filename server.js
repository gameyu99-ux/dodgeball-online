'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8093;

/* ══════════════════════════════════════════
   Vec3 — lightweight 3-vector (no Three.js)
   ══════════════════════════════════════════ */
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { const l = this.length(); if (l > 0) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  distanceTo(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
}
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/* ══════════════════════════════════════════
   Game constants (mirrors client CFG)
   ══════════════════════════════════════════ */
const CFG = {
  COURT_L: 28, COURT_W: 14, OUTFIELD_D: 8,
  PLAYER_H: 1.7, CROUCH_H: 0.9, PLAYER_R: 0.3,
  EYE_H: 1.55, CROUCH_EYE: 0.75,
  BALL_R: 0.14, BALL_COUNT: 1, TEAM_SIZE: 10,
  MOVE_SPD: 5.5, THROW_SPD: 19, JUMP_V: 7.5, GRAVITY: -18,
  CATCH_PERFECT: [0.1, 8.5],
  CATCH_OK: [8.5, 10.5],
  AI_THROW_DELAY: [1.6, 3.0],
  AI_INTERCEPT_THROW_DELAY: [0.6, 1.4],
  AI_DODGE_CHANCE: 0.6,
  AI_CATCH_CHANCE: 0.09,
  AI_ACCURACY: 0.7,
  AI_RETURN_CHANCE: 0.7
};
const TOTAL_L = CFG.COURT_L + CFG.OUTFIELD_D * 2;
const TOTAL_W = CFG.COURT_W + CFG.OUTFIELD_D * 2;
const TEAM_BLUE = 0, TEAM_RED = 1;
const INITIAL_OUTFIELD = 2;
const GAME_LIMIT = 270;
const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;

/* ══════════════════════════════════════════
   ServerPlayer
   ══════════════════════════════════════════ */
class ServerPlayer {
  constructor(id, team, isHuman) {
    this.id = id;
    this.team = team;
    this.isHuman = isHuman;
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.yaw = team === TEAM_BLUE ? Math.PI : 0;
    this.pitch = 0;
    this.height = CFG.PLAYER_H;
    this.eyeH = CFG.EYE_H;
    this.crouching = false;
    this.jumping = false;
    this.grounded = true;
    this.alive = true;
    this.inField = true;
    this.ball = null;
    this.throwCooldown = 0;
    this.catchImmunity = 0;
    this.hitFlash = 0;
    this.catchAttempt = false;
    this.aiState = 'idle';
    this.aiTimer = Math.random() * 2;
    this.aiTarget = new Vec3();
    this.aiDodgeDir = 0;
    this.targetBall = null;
    this._throwHold = 0;
    this._catchTimer = null;
    this.stats = { infieldHits: 0, outfieldHits: 0, infieldTime: 0 };
  }

  getBounds() {
    const hW = CFG.COURT_W / 2 - 0.3, hL = CFG.COURT_L / 2, oD = CFG.OUTFIELD_D - 0.3;
    if (this.inField) {
      return this.team === TEAM_BLUE
        ? { xMin: -hW, xMax: hW, zMin: -hL + 0.3, zMax: -0.15 }
        : { xMin: -hW, xMax: hW, zMin: 0.15, zMax: hL - 0.3 };
    }
    return this.team === TEAM_BLUE
      ? { xMin: -hW - oD, xMax: hW + oD, zMin: 0.2, zMax: hL + oD }
      : { xMin: -hW - oD, xMax: hW + oD, zMin: -hL - oD, zMax: -0.2 };
  }

  setStartPos(idx) {
    const side = this.team === TEAM_BLUE ? -1 : 1;
    const order = [2, 1, 3, 0, 4];
    const row = Math.floor(idx / 5);
    const col = order[idx % 5];
    this.pos.set((col - 2) * 2.5, 0, side * (2.5 + row * 3));
    this.yaw = this.team === TEAM_BLUE ? Math.PI : 0;
  }

  update(dt) {
    if (!this.alive) return;
    this.vel.y += CFG.GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.grounded = true; this.jumping = false; }

    const b = this.getBounds();
    this.pos.x = clamp(this.pos.x, b.xMin, b.xMax);
    this.pos.z = clamp(this.pos.z, b.zMin, b.zMax);

    if (!this.inField) {
      const hW = CFG.COURT_W / 2, hL = CFG.COURT_L / 2;
      if (Math.abs(this.pos.x) < hW) {
        if (this.team === TEAM_BLUE && this.pos.z < hL) {
          const dSide = Math.min(this.pos.x + hW, hW - this.pos.x);
          const dZ = Math.min(this.pos.z, hL - this.pos.z);
          if (dSide < dZ) this.pos.x = this.pos.x < 0 ? -hW - 0.1 : hW + 0.1;
          else if (this.pos.z < hL * 0.5) this.pos.z = 0.2;
          else this.pos.z = hL;
        } else if (this.team === TEAM_RED && this.pos.z > -hL) {
          const dSide = Math.min(this.pos.x + hW, hW - this.pos.x);
          const dZ = Math.min(-this.pos.z, hL + this.pos.z);
          if (dSide < dZ) this.pos.x = this.pos.x < 0 ? -hW - 0.1 : hW + 0.1;
          else if (this.pos.z > -hL * 0.5) this.pos.z = -0.2;
          else this.pos.z = -hL;
        }
      }
    }

    if (this.crouching) {
      this.height = lerp(this.height, CFG.CROUCH_H, dt * 10);
      this.eyeH = lerp(this.eyeH, CFG.CROUCH_EYE, dt * 10);
    } else {
      this.height = lerp(this.height, CFG.PLAYER_H, dt * 10);
      this.eyeH = lerp(this.eyeH, CFG.EYE_H, dt * 10);
    }
    if (this.throwCooldown > 0) this.throwCooldown -= dt;
    if (this.catchImmunity > 0) this.catchImmunity -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  jump() {
    if (this.grounded && !this.jumping) {
      this.vel.y = CFG.JUMP_V; this.grounded = false; this.jumping = true;
    }
  }
  setCrouch(v) { this.crouching = v; }

  throwBall(dir, room) {
    if (!this.ball || this.throwCooldown > 0) return;
    const b = this.ball; this.ball = null; b.heldBy = null;
    const lp = this.pos.clone(); lp.y += this.eyeH;
    lp.addScaledVector(dir, 0.5);
    b.launch(lp, dir, this, this.jumping ? 22 : CFG.THROW_SPD);
    this.throwCooldown = 0.3;
    room.pendingEvents.push({ type: 'sfx', name: 'throw' });
    if (this.jumping) {
      room.pendingEvents.push({ type: 'jumpshot', slot: this.id });
    }
  }

  pickUp(ball) {
    if (this.ball) return;
    this.ball = ball; ball.heldBy = this; ball.flying = false; ball.vel.set(0, 0, 0);
    ball.thrownBy = null;
    if (this.isHuman) this.catchImmunity = 1.0;
  }

  sendToOutfield() {
    if (this.ball) { this.ball.heldBy = null; this.ball.drop(this.pos); this.ball = null; }
    this.inField = false;
    this.hitFlash = 1;
    const hW = CFG.COURT_W / 2, hL = CFG.COURT_L / 2, oD = CFG.OUTFIELD_D;
    const zone = Math.floor(Math.random() * 3);
    let x, z;
    if (this.team === TEAM_BLUE) {
      if (zone === 0) { x = (Math.random() - 0.5) * (TOTAL_W - 1); z = hL + 0.5 + Math.random() * (oD - 1); }
      else if (zone === 1) { x = hW + 0.4 + Math.random() * (oD - 0.8); z = Math.random() * hL; }
      else { x = -(hW + 0.4 + Math.random() * (oD - 0.8)); z = Math.random() * hL; }
    } else {
      if (zone === 0) { x = (Math.random() - 0.5) * (TOTAL_W - 1); z = -(hL + 0.5 + Math.random() * (oD - 1)); }
      else if (zone === 1) { x = hW + 0.4 + Math.random() * (oD - 0.8); z = -Math.random() * hL; }
      else { x = -(hW + 0.4 + Math.random() * (oD - 0.8)); z = -Math.random() * hL; }
    }
    this.pos.set(x, 0, z);
    const tz = this.team === TEAM_BLUE ? hL / 2 : -hL / 2;
    this.yaw = Math.atan2(-(0 - this.pos.x), -(tz - this.pos.z));
    this.vel.set(0, 0, 0);
  }

  returnToInfield() {
    this.inField = true;
    const hL = CFG.COURT_L / 2;
    if (this.team === TEAM_BLUE) {
      this.pos.set((Math.random() - 0.5) * (CFG.COURT_W - 2), 0, -(hL * 0.5));
      this.yaw = Math.PI;
    } else {
      this.pos.set((Math.random() - 0.5) * (CFG.COURT_W - 2), 0, hL * 0.5);
      this.yaw = 0;
    }
    this.vel.set(0, 0, 0);
  }

  getForward() { return new Vec3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  getLookDir() {
    return new Vec3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }
}

/* ══════════════════════════════════════════
   ServerBall
   ══════════════════════════════════════════ */
class ServerBall {
  constructor(id) {
    this.id = id;
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.flying = false;
    this.heldBy = null;
    this.thrownBy = null;
    this.looseTimer = 999; // 何秒前から地面に落ちているか(AIの反応猶予に使う)
  }

  setStart() {
    this.pos.set(0, CFG.BALL_R, 0);
    this.vel.set(0, 0, 0); this.flying = false; this.heldBy = null; this.thrownBy = null;
    this.looseTimer = 999;
  }

  launch(pos, dir, thrower, speed) {
    this.pos.copy(pos);
    this.vel.copy(dir).multiplyScalar(speed);
    this.vel.y += 1.5;
    this.flying = true; this.thrownBy = thrower;
    this.looseTimer = 0;
  }

  drop(pos) {
    this.pos.set(pos.x, CFG.BALL_R, pos.z);
    this.vel.set(0, 0, 0); this.flying = false; this.thrownBy = null;
    this.looseTimer = 0;
  }

  update(dt, room) {
    if (this.heldBy) {
      const p = this.heldBy, fwd = p.getForward();
      this.pos.set(
        p.pos.x + fwd.x * 0.5 + Math.sin(p.yaw + Math.PI / 2) * 0.3,
        p.pos.y + p.eyeH - 0.2,
        p.pos.z + fwd.z * 0.5 + Math.cos(p.yaw + Math.PI / 2) * 0.3
      );
      return;
    }

    if (this.flying) {
      this.vel.y += CFG.GRAVITY * 0.4 * dt;
      this.pos.addScaledVector(this.vel, dt);

      const hWT = TOTAL_W / 2, hLT = TOTAL_L / 2;
      if (Math.abs(this.pos.x) > hWT + 1 || Math.abs(this.pos.z) > hLT + 1 || this.pos.y < -1) {
        this.outOfBounds(); return;
      }
      if (this.pos.y <= CFG.BALL_R) {
        this.pos.y = CFG.BALL_R;
        this.flying = false; this.vel.multiplyScalar(0.3); this.vel.y = 0;
        this.thrownBy = null;
        this.looseTimer = 0;
      }
      this.checkHitPlayers(room);
    } else {
      this.looseTimer += dt;
      this.vel.multiplyScalar(0.95);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = CFG.BALL_R;

      const hWT = TOTAL_W / 2, hLT = TOTAL_L / 2;
      if (Math.abs(this.pos.x) > hWT) this.vel.x *= -0.5;
      if (Math.abs(this.pos.z) > hLT) this.vel.z *= -0.5;
      this.pos.x = clamp(this.pos.x, -hWT, hWT);
      this.pos.z = clamp(this.pos.z, -hLT, hLT);
    }
  }

  checkHitPlayers(room) {
    if (!this.thrownBy) return;
    const thrower = this.thrownBy;
    const players = room.players;

    // ① Friendly catch (outfield thrower → teammate infield)
    if (!thrower.inField) {
      for (const p of players) {
        if (!p.alive || !p.inField || p.team !== thrower.team) continue;
        const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z;
        if (Math.sqrt(dx * dx + dz * dz) < CFG.PLAYER_R + CFG.BALL_R + 0.3 &&
          this.pos.y > p.pos.y && this.pos.y < p.pos.y + p.height + 0.2) {
          if (p.isHuman && p.catchAttempt) {
            const dist = this.pos.distanceTo(p.pos);
            p.catchAttempt = false;
            if (dist < CFG.CATCH_PERFECT[1] && dist > CFG.CATCH_PERFECT[0]) {
              p.pickUp(this);
              p.catchImmunity = 0.8;
              room.pendingEvents.push({ type: 'sfx', name: 'catch', slot: p.id });
              room.pendingEvents.push({ type: 'msg', text: 'キャッチ！', color: '#0f0', slot: p.id });
            } else {
              room.pendingEvents.push({ type: 'msg', text: 'キャッチ失敗...', color: '#f44', slot: p.id });
              this.drop(this.pos);
            }
            return;
          } else if (!p.isHuman && Math.random() < 0.35) {
            p.pickUp(this); return;
          }
        }
      }
    }

    // ② Enemy hit detection
    for (const p of players) {
      if (!p.alive || p.team === thrower.team) continue;
      if (!p.inField) continue;
      if (p.isHuman && p.catchImmunity > 0) continue;

      const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z;
      const horizDist = Math.sqrt(dx * dx + dz * dz);

      if (horizDist < CFG.PLAYER_R + CFG.BALL_R + 0.15 &&
        this.pos.y > p.pos.y && this.pos.y < p.pos.y + p.height + 0.2) {

        if (p.isHuman && p.catchAttempt) {
          const dist = this.pos.distanceTo(p.pos);
          p.catchAttempt = false;
          if (dist < CFG.CATCH_PERFECT[1] && dist > CFG.CATCH_PERFECT[0]) {
            p.pickUp(this);
            p.catchImmunity = 0.8;
            room.pendingEvents.push({ type: 'sfx', name: 'catch', slot: p.id });
            room.pendingEvents.push({ type: 'msg', text: 'NICE CATCH!', color: '#0f0', slot: p.id });
            return;
          } else {
            room.pendingEvents.push({ type: 'msg', text: 'CATCH FAILED...', color: '#f44', slot: p.id });
          }
        }

        if (thrower.inField) thrower.stats.infieldHits++;
        else thrower.stats.outfieldHits++;

        room.pendingEvents.push({ type: 'sfx', name: 'hit' });
        room.pendingEvents.push({
          type: 'hit',
          x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
          thrower: thrower.id
        });
        p.sendToOutfield();
        if (p.isHuman) {
          room.pendingEvents.push({ type: 'sfx', name: 'outfield', slot: p.id });
          room.pendingEvents.push({ type: 'msg', text: '外野へ移動！', color: '#f80', slot: p.id });
        }
        this.drop(this.pos);
        if (!thrower.inField) room.onOutfieldHit(thrower);
        return;
      }
    }
  }

  outOfBounds() {
    const hWT = TOTAL_W / 2, hLT = TOTAL_L / 2;
    this.pos.set(
      clamp(this.pos.x, -hWT + 1, hWT - 1),
      CFG.BALL_R,
      clamp(this.pos.z, -hLT + 1, hLT - 1)
    );
    this.vel.set(0, 0, 0); this.flying = false; this.thrownBy = null;
    this.looseTimer = 0;
  }
}

/* ══════════════════════════════════════════
   AI helper functions
   ══════════════════════════════════════════ */
function ballReachable(p, b) {
  const bd = p.getBounds();
  return b.pos.z >= bd.zMin - 0.5 && b.pos.z <= bd.zMax + 0.5
    && b.pos.x >= bd.xMin - 0.5 && b.pos.x <= bd.xMax + 0.5;
}

function outfieldNavTarget(p, targetPos) {
  if (p.inField) return targetPos.clone();
  const hW = CFG.COURT_W / 2, hL = CFG.COURT_L / 2, oD = CFG.OUTFIELD_D;
  const forbidden = (x, z) => p.team === TEAM_BLUE
    ? Math.abs(x) < hW - 0.3 && z > 0.3 && z < hL - 0.3
    : Math.abs(x) < hW - 0.3 && z < -0.3 && z > -(hL - 0.3);
  let crosses = false;
  for (let t = 0.15; t <= 0.85; t += 0.15) {
    const mx = p.pos.x + (targetPos.x - p.pos.x) * t;
    const mz = p.pos.z + (targetPos.z - p.pos.z) * t;
    if (forbidden(mx, mz)) { crosses = true; break; }
  }
  if (!crosses) return targetPos.clone();
  const backZ = p.team === TEAM_BLUE ? hL + oD * 0.5 : -(hL + oD * 0.5);
  const midX = clamp((p.pos.x + targetPos.x) * 0.5, -(hW + oD - 0.5), hW + oD - 0.5);
  return new Vec3(midX, 0, backZ);
}

function findSeekableBall(p, room) {
  let best = null, bestD = Infinity;
  for (const b of room.balls) {
    if (b.heldBy || b.flying) continue;
    if (!ballReachable(p, b)) continue;
    const d = b.pos.distanceTo(p.pos);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function pickOutfieldTarget(p) {
  const hW = CFG.COURT_W / 2, hL = CFG.COURT_L / 2, oD = CFG.OUTFIELD_D;
  const zone = Math.floor(Math.random() * 3), r = () => Math.random();
  if (p.team === TEAM_BLUE) {
    if (zone === 0) return new Vec3((r() - 0.5) * (TOTAL_W - 2), 0, hL + 0.5 + r() * (oD - 1));
    if (zone === 1) return new Vec3(hW + 0.5 + r() * (oD - 1), 0, r() * hL * 0.9);
    return new Vec3(-(hW + 0.5 + r() * (oD - 1)), 0, r() * hL * 0.9);
  } else {
    if (zone === 0) return new Vec3((r() - 0.5) * (TOTAL_W - 2), 0, -(hL + 0.5 + r() * (oD - 1)));
    if (zone === 1) return new Vec3(hW + 0.5 + r() * (oD - 1), 0, -r() * hL * 0.9);
    return new Vec3(-(hW + 0.5 + r() * (oD - 1)), 0, -r() * hL * 0.9);
  }
}

function canPickUp(p, b, maxDist = 1.5) {
  if (b.heldBy || b.flying) return false;
  if (b.pos.distanceTo(p.pos) > maxDist) return false;
  return ballReachable(p, b);
}

function findTarget(p, room) {
  const humanTargets = room.players.filter(t =>
    t.isHuman && t.alive && t.inField && t.team !== p.team
  );
  if (humanTargets.length > 0 && Math.random() < 0.25) {
    return humanTargets[Math.floor(Math.random() * humanTargets.length)];
  }
  let best = null, bestD = Infinity;
  for (const t of room.players) {
    if (!t.alive || t.team === p.team || !t.inField) continue;
    const d = t.pos.distanceTo(p.pos);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function findIncomingBall(p, room) {
  for (const b of room.balls) {
    if (!b.flying || !b.thrownBy || b.thrownBy.team === p.team) continue;
    const toP = p.pos.clone().sub(b.pos);
    const dist = toP.length();
    if (dist >= 8) continue;
    const dir = b.vel.clone().normalize();
    const along = toP.dot(dir);
    if (along <= 0) continue;
    // 弾道の真正面にいる相手だけを「向かってくるボール」とみなす。
    // 単純な内積>0だけだと視野の広い範囲の敵まで拾ってしまい、
    // 複数のAIが同時にキャッチ判定を持って成功率が高くなりすぎていた
    const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
    if (perp < 1.3) return b;
  }
  return null;
}

function updateAI(p, dt, room) {
  if (!p.alive) return;
  p.aiTimer -= dt;

  if (p.inField) {
    const incoming = findIncomingBall(p, room);
    if (incoming && !p.ball) {
      const dist = incoming.pos.distanceTo(p.pos);
      if (dist < 6 && Math.random() < CFG.AI_CATCH_CHANCE * dt * 2) {
        if (dist > CFG.CATCH_PERFECT[0] && dist < CFG.CATCH_PERFECT[1]) {
          p.pickUp(incoming);
          incoming.thrownBy = null;
          p.aiState = 'has_ball';
          p.aiTimer = CFG.AI_INTERCEPT_THROW_DELAY[0] + Math.random() * (CFG.AI_INTERCEPT_THROW_DELAY[1] - CFG.AI_INTERCEPT_THROW_DELAY[0]);
          return;
        }
      }
      if (Math.random() < CFG.AI_DODGE_CHANCE * dt * 3) {
        p.aiState = 'dodging'; p.aiDodgeDir = Math.random() > 0.5 ? 1 : -1;
        if (Math.random() < 0.3) p.jump();
        if (Math.random() < 0.2) p.setCrouch(true);
      }
    } else {
      p.setCrouch(false);
    }
  }

  if (p.ball) {
    p.aiState = 'has_ball';
    if (p.aiTimer <= 0) {
      const outfieldHumans = room.players.filter(p2 =>
        p2.isHuman && p2.alive && !p2.inField && p2.team === p.team
      );
      const passTarget = outfieldHumans.length > 0 && Math.random() < 0.8
        ? outfieldHumans[Math.floor(Math.random() * outfieldHumans.length)]
        : null;
      if (p.inField && passTarget) {
        const aim = passTarget.pos.clone();
        aim.x += (Math.random() - 0.5) * 2.5;
        aim.z += (Math.random() - 0.5) * 2.5;
        const dir = aim.sub(p.pos);
        dir.y = 0; dir.normalize();
        dir.y = 0.25 + Math.random() * 0.15;
        dir.normalize();
        p.yaw = Math.atan2(-dir.x, -dir.z);
        p.throwBall(dir, room);
      } else {
        const target = findTarget(p, room);
        if (target) {
          const dir = target.pos.clone().sub(p.pos);
          dir.y = 0; dir.normalize();
          dir.y = Math.random() < 0.5 ? -0.06 + Math.random() * 0.1 : 0.08 + Math.random() * 0.12;
          dir.x += (Math.random() - 0.5) * (1 - CFG.AI_ACCURACY) * 0.7;
          dir.z += (Math.random() - 0.5) * (1 - CFG.AI_ACCURACY) * 0.7;
          dir.normalize();
          p.yaw = Math.atan2(-dir.x, -dir.z);
          p.throwBall(dir, room);
        }
      }
      p.aiTimer = CFG.AI_THROW_DELAY[0] + Math.random() * (CFG.AI_THROW_DELAY[1] - CFG.AI_THROW_DELAY[0]);
    }
    return;
  }

  switch (p.aiState) {
    case 'dodging':
      p.vel.x = p.aiDodgeDir * CFG.MOVE_SPD;
      p.vel.z *= 0.3;
      if (p.aiTimer <= 0) { p.aiState = 'idle'; p.aiTimer = 0.3 + Math.random() * 0.5; p.setCrouch(false); }
      break;

    case 'seeking_ball': {
      const tb = p.targetBall;
      if (tb && !tb.heldBy && !tb.flying && ballReachable(p, tb)) {
        const navTarget = outfieldNavTarget(p, tb.pos);
        const dir = navTarget.sub(p.pos); dir.y = 0;
        if (dir.length() < 0.8 && tb.pos.distanceTo(p.pos) < 0.9) {
          p.pickUp(tb); p.targetBall = null; p.aiState = 'has_ball';
          p.aiTimer = CFG.AI_THROW_DELAY[0] + Math.random() * (CFG.AI_THROW_DELAY[1] - CFG.AI_THROW_DELAY[0]);
        } else {
          dir.normalize();
          p.vel.x = dir.x * CFG.MOVE_SPD * 0.9;
          p.vel.z = dir.z * CFG.MOVE_SPD * 0.9;
          p.yaw = Math.atan2(-dir.x, -dir.z);
        }
      } else {
        p.targetBall = null; p.aiState = 'idle'; p.aiTimer = 0.3;
      }
      break;
    }

    default: {
      if (p._seekDelay > 0) {
        p._seekDelay -= dt;
        if (p._seekDelay <= 0 && p._pendingSeekBall && !p._pendingSeekBall.heldBy && !p._pendingSeekBall.flying && ballReachable(p, p._pendingSeekBall)) {
          p.aiState = 'seeking_ball'; p.targetBall = p._pendingSeekBall; p._pendingSeekBall = null; p.aiTimer = 5;
        } else if (p._seekDelay <= 0) { p._pendingSeekBall = null; }
        break;
      }
      if (p.aiTimer <= 0) {
        const seekBall = findSeekableBall(p, room);
        if (seekBall) {
          p._pendingSeekBall = seekBall;
          p._seekDelay = 0.6 + Math.random() * 1.0;
          break;
        }
        if (p.inField) {
          const b = p.getBounds();
          p.aiTarget.set(
            b.xMin + Math.random() * (b.xMax - b.xMin), 0,
            b.zMin + Math.random() * (b.zMax - b.zMin)
          );
        } else {
          p.aiTarget = pickOutfieldTarget(p);
        }
        p.aiTimer = 0.5 + Math.random() * 1.0;
      }
      const toT = p.aiTarget.clone().sub(p.pos); toT.y = 0;
      if (toT.length() > 0.5) {
        toT.normalize();
        p.vel.x = toT.x * CFG.MOVE_SPD * 0.45;
        p.vel.z = toT.z * CFG.MOVE_SPD * 0.45;
        p.yaw = Math.atan2(-toT.x, -toT.z);
      } else { p.vel.x *= 0.9; p.vel.z *= 0.9; }
    }
  }
}

/* ══════════════════════════════════════════
   GameRoom — server-authoritative simulation
   ══════════════════════════════════════════ */
class GameRoom {
  constructor(key) {
    this.key = key;
    this.clients = new Map();   // ws → { slot, name }
    this.hostWs = null;
    this.slots = new Array(20).fill(null);
    this.lobbyState = 'waiting'; // waiting | playing

    this.players = [];
    this.balls = [];
    this.gameState = 'idle';     // idle | countdown | playing | ended
    this.countdownTimer = 0;
    this.gameTime = 0;
    this.ballMilestones = [];
    this.paused = false;
    this._choiceThrower = null;
    this.pendingEvents = [];
    this.inputs = {};            // slot → input object
    this._tickIv = null;
    this.isRanked = false;
  }

  assignSlot(ws) {
    const blueCount = this.slots.slice(0, 8).filter(Boolean).length;
    const redCount = this.slots.slice(10, 18).filter(Boolean).length;
    let start, end;
    if (blueCount <= redCount) { start = 0; end = 8; }
    else { start = 10; end = 18; }
    for (let i = start; i < end; i++) { if (!this.slots[i]) { this.slots[i] = ws; return i; } }
    for (let i = 0; i < 8; i++) { if (!this.slots[i]) { this.slots[i] = ws; return i; } }
    for (let i = 10; i < 18; i++) { if (!this.slots[i]) { this.slots[i] = ws; return i; } }
    return -1;
  }

  removePlayer(ws) {
    const idx = this.slots.indexOf(ws);
    if (idx !== -1) {
      this.slots[idx] = null;
      delete this.inputs[idx];
      if (this.gameState === 'playing' || this.gameState === 'countdown') {
        const p = this.players.find(pl => pl.id === idx);
        if (p) p.isHuman = false;
      }
    }
    this.clients.delete(ws);
  }

  getSlotList() {
    return this.slots.map((ws, i) => {
      if (!ws) return null;
      const info = this.clients.get(ws);
      return info ? { slot: i, name: info.name, skin: info.skin || 'default' } : null;
    }).filter(Boolean);
  }

  getHumanSlots() {
    return this.getSlotList().map(p => p.slot);
  }

  broadcast(msg, exclude = null) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.clients) {
      if (ws !== exclude && ws.readyState === 1) ws.send(data);
    }
  }

  sendTo(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /* ── Game lifecycle ── */

  startGame() {
    this.lobbyState = 'playing';
    this.players.length = 0;
    this.balls.length = 0;
    this.inputs = {};
    this.pendingEvents = [];
    this.paused = false;
    this._choiceThrower = null;

    const humanSlots = this.getHumanSlots();

    for (let i = 0; i < CFG.TEAM_SIZE; i++) {
      const p = new ServerPlayer(i, TEAM_BLUE, humanSlots.includes(i));
      p.inField = true;
      p.setStartPos(i);
      this.players.push(p);
    }
    for (let i = 0; i < CFG.TEAM_SIZE; i++) {
      const slot = CFG.TEAM_SIZE + i;
      const p = new ServerPlayer(slot, TEAM_RED, humanSlots.includes(slot));
      p.inField = true;
      p.setStartPos(i);
      this.players.push(p);
    }

    for (let i = CFG.TEAM_SIZE - INITIAL_OUTFIELD; i < CFG.TEAM_SIZE; i++) {
      const p = this.players[i];
      if (!p.isHuman) p.sendToOutfield();
    }
    for (let i = CFG.TEAM_SIZE * 2 - INITIAL_OUTFIELD; i < CFG.TEAM_SIZE * 2; i++) {
      const p = this.players[i];
      if (!p.isHuman) p.sendToOutfield();
    }

    for (let i = 0; i < CFG.BALL_COUNT; i++) {
      const b = new ServerBall(i); b.setStart(); this.balls.push(b);
    }

    this.gameTime = 0;
    this.ballMilestones = [90, 180];
    this.gameState = 'countdown';
    this.countdownTimer = 3.5;

    this.broadcast({ type: 'game_start', players: this.getSlotList() });

    // setIntervalは遅延が蓄積してゲーム内時間が実時間より遅く進むため、
    // 実経過時間ぶんのtickをまとめて回して実時間に同期させる
    this._lastTick = Date.now();
    this._tickAcc = 0;
    this._tickIv = setInterval(() => {
      const now = Date.now();
      this._tickAcc += Math.min((now - this._lastTick) / 1000, 0.2);
      this._lastTick = now;
      const step = 1 / TICK_RATE;
      while (this._tickAcc >= step && this._tickIv) {
        this._tickAcc -= step;
        this.tick();
      }
    }, TICK_MS / 2);
  }

  tick() {
    const dt = 1 / TICK_RATE;

    if (this.gameState === 'countdown') {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.gameState = 'playing';
      }
      this.broadcastState();
      return;
    }

    if (this.gameState !== 'playing') return;

    // Apply human inputs
    for (const p of this.players) {
      if (!p.isHuman || !p.alive) continue;
      const input = this.inputs[p.id];
      if (!input) continue;

      p.yaw = input.yaw;
      p.pitch = input.pitch;

      const fwd = p.getForward();
      const right = new Vec3(-fwd.z, 0, fwd.x);
      const move = new Vec3();
      if (input.up) move.add(fwd);
      if (input.down) move.sub(fwd);
      if (input.left) move.sub(right);
      if (input.right) move.add(right);

      if (move.length() > 0) {
        move.normalize();
        const spd = p.crouching ? CFG.MOVE_SPD * 0.5 : CFG.MOVE_SPD;
        p.vel.x = move.x * spd; p.vel.z = move.z * spd;
      } else { p.vel.x *= 0.85; p.vel.z *= 0.85; }

      if (input.jump) { p.jump(); input.jump = false; }
      p.setCrouch(!!input.crouch);

      // throwはワンショット消費。クライアント予測でボールを拾った直後の
      // クリックはサーバー側でまだ未所持のことがあるため、少しの間保持する
      if (input.throw) {
        if (p.ball) {
          p.throwBall(p.getLookDir(), this);
          input.throw = false; p._throwHold = 0;
        } else if (++p._throwHold > 15) {
          input.throw = false; p._throwHold = 0;
        }
      } else {
        p._throwHold = 0;
      }

      if (input.catch) {
        input.catch = false;
        p.catchAttempt = true;
        clearTimeout(p._catchTimer);
        p._catchTimer = setTimeout(() => { p.catchAttempt = false; }, 800);
      }
    }

    // AI
    for (const p of this.players) {
      if (!p.isHuman && p.alive) updateAI(p, dt, this);
    }

    // Physics
    for (const p of this.players) p.update(dt);
    for (const b of this.balls) b.update(dt, this);

    // Human ball pickup — AIより先に判定して人間を優先。
    // クライアント予測(1.2m)はクライアント予測位置基準で、サーバー側の
    // 位置とは僅かにズレるため、サーバーは広め(2.0m)に取って予測却下を防ぐ
    for (const p of this.players) {
      if (!p.alive || p.ball || !p.isHuman) continue;
      for (const b of this.balls) {
        if (b.heldBy || b.flying) continue;
        if (canPickUp(p, b, 2.0)) { p.pickUp(b); break; }
      }
    }

    // AI ball pickup — 落ちた直後は少し反応猶予を与え、通信遅延のある
    // 人間プレイヤーがボールに到達する前にAIが横取りしてしまうのを防ぐ
    for (const p of this.players) {
      if (!p.alive || p.ball || p.isHuman) continue;
      for (const b of this.balls) {
        if (b.heldBy || b.flying || b.looseTimer < 0.12) continue;
        if (b.pos.distanceTo(p.pos) < 1.0 && canPickUp(p, b)) {
          p.pickUp(b);
          p.aiState = 'has_ball';
          p.aiTimer = CFG.AI_THROW_DELAY[0] + Math.random() * (CFG.AI_THROW_DELAY[1] - CFG.AI_THROW_DELAY[0]);
          break;
        }
      }
    }

    // Track infield survival time for human players
    for (const p of this.players) {
      if (p.isHuman && p.alive && p.inField) p.stats.infieldTime += dt;
    }

    // Game timer + milestones
    this.gameTime += dt;
    while (this.ballMilestones.length && this.gameTime >= this.ballMilestones[0]) {
      this.ballMilestones.shift();
      this.addExtraBall();
    }

    // Win conditions
    if (this.gameTime >= GAME_LIMIT) {
      const blueIn = this.players.filter(p => p.team === TEAM_BLUE && p.alive && p.inField).length;
      const redIn = this.players.filter(p => p.team === TEAM_RED && p.alive && p.inField).length;
      this.endGame(blueIn >= redIn ? TEAM_BLUE : TEAM_RED);
      return;
    }
    const blueIn = this.players.filter(p => p.team === TEAM_BLUE && p.alive && p.inField).length;
    const redIn = this.players.filter(p => p.team === TEAM_RED && p.alive && p.inField).length;
    if (blueIn === 0 || redIn === 0) {
      this.endGame(blueIn > 0 ? TEAM_BLUE : TEAM_RED);
      return;
    }

    this.broadcastState();
  }

  addExtraBall() {
    const hW = CFG.COURT_W / 2 - 1, hL = CFG.COURT_L / 2 - 1;
    const b = new ServerBall(this.balls.length);
    const side = Math.random() < 0.5 ? -1 : 1;
    b.pos.set((Math.random() - 0.5) * hW * 2, CFG.BALL_R, side * (1 + Math.random() * (hL - 1)));
    b.vel.set(0, 0, 0); b.flying = false;
    this.balls.push(b);
    this.pendingEvents.push({ type: 'msg', text: 'ボール追加！', color: '#ff0' });
  }

  onOutfieldHit(thrower) {
    if (thrower.isHuman) {
      this._choiceThrower = thrower;
      const ws = this.slots[thrower.id];
      if (ws) this.sendTo(ws, { type: 'choice_request' });
      this._choiceTimeout = setTimeout(() => {
        if (this._choiceThrower === thrower) this.resolveChoice(false);
      }, 5000);
    } else {
      const infieldCount = this.players.filter(p => p.team === thrower.team && p.alive && p.inField).length;
      const returnChance = 0.25 + 0.75 * (1 - infieldCount / CFG.TEAM_SIZE);
      if (Math.random() < returnChance) thrower.returnToInfield();
    }
  }

  resolveChoice(returnToField) {
    if (this._choiceTimeout) { clearTimeout(this._choiceTimeout); this._choiceTimeout = null; }
    if (this._choiceThrower) {
      const slot = this._choiceThrower.id;
      if (returnToField) {
        this._choiceThrower.returnToInfield();
        this.pendingEvents.push({ type: 'msg', text: '内野に復帰！', color: '#0f0', slot });
      } else {
        this.pendingEvents.push({ type: 'msg', text: '外野に残留', color: '#ff0', slot });
      }
      this._choiceThrower = null;
    }
  }

  endGame(winnerTeam) {
    this.gameState = 'ended';
    for (const [ws, info] of this.clients) {
      const p = this.players.find(pl => pl.id === info.slot);
      if (p) {
        this.sendTo(ws, {
          type: 'game_end_stats',
          ranked: this.isRanked,
          won: p.team === winnerTeam,
          stats: {
            infieldHits: p.stats.infieldHits,
            outfieldHits: p.stats.outfieldHits,
            infieldTime: +p.stats.infieldTime.toFixed(1)
          }
        });
      }
    }
    this.broadcastState();
    if (this._tickIv) { clearInterval(this._tickIv); this._tickIv = null; }
    this.lobbyState = 'waiting';
  }

  broadcastState() {
    const st = {
      p: this.players.map(p => [
        +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2),
        +p.yaw.toFixed(3), +p.pitch.toFixed(3),
        p.inField ? 1 : 0, p.alive ? 1 : 0, p.crouching ? 1 : 0,
        p.ball ? p.ball.id : -1, +p.height.toFixed(2), +(p.hitFlash || 0).toFixed(2)
      ]),
      b: this.balls.map(b => [
        +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2),
        +b.vel.x.toFixed(1), +b.vel.y.toFixed(1), +b.vel.z.toFixed(1),
        b.flying ? 1 : 0, b.heldBy ? b.heldBy.id : -1,
        b.thrownBy ? b.thrownBy.team : -1,
        b.thrownBy ? b.thrownBy.id : -1 // スキントレイル用に投げた人のスロットも配る
      ]),
      t: +this.gameTime.toFixed(1),
      s: this.gameState,
      c: +this.countdownTimer.toFixed(1),
      ev: this.pendingEvents.splice(0)
    };
    const data = JSON.stringify({ type: 'game_state', state: st });
    for (const [ws] of this.clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  destroy() {
    if (this._tickIv) { clearInterval(this._tickIv); this._tickIv = null; }
    if (this._choiceTimeout) { clearTimeout(this._choiceTimeout); this._choiceTimeout = null; }
    for (const p of this.players) { clearTimeout(p._catchTimer); }
  }
}

/* ══════════════════════════════════════════
   HTTP server
   ══════════════════════════════════════════ */
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/dodgeball.html' : req.url;
  filePath = filePath.split('?')[0];
  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);
  const types = {
    '.html': 'text/html', '.js': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg'
  };
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ══════════════════════════════════════════
   WebSocket server + message handling
   ══════════════════════════════════════════ */
const wss = new WebSocketServer({ server });
const rooms = new Map();

function genKey() {
  let key;
  do { key = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(key));
  return key;
}

/* ── Matchmaking (ranked + casual queues) ── */
const MATCH_COUNTDOWN_SEC = 60;
const MATCH_MAX = 16;
const queues = {
  casual: { list: [], timer: null, timerStart: null, broadcastIv: null, ranked: false },
  ranked: { list: [], timer: null, timerStart: null, broadcastIv: null, ranked: true }
};

function addToQueue(queueType, ws, name, skin) {
  removeFromAnyQueue(ws);
  const q = queues[queueType];
  ws._queueType = queueType;
  q.list.push({ ws, name, skin });
  broadcastQueueStatus(q);

  if (q.list.length >= MATCH_MAX) {
    startQueueMatch(q);
  } else if (!q.timer) {
    q.timerStart = Date.now();
    q.timer = setTimeout(() => startQueueMatch(q), MATCH_COUNTDOWN_SEC * 1000);
    if (!q.broadcastIv) {
      q.broadcastIv = setInterval(() => {
        if (q.list.length === 0) {
          clearInterval(q.broadcastIv); q.broadcastIv = null; return;
        }
        broadcastQueueStatus(q);
      }, 1000);
    }
  }
}

function removeFromAnyQueue(ws) {
  for (const key of ['casual', 'ranked']) {
    const q = queues[key];
    const idx = q.list.findIndex(p => p.ws === ws);
    if (idx !== -1) { q.list.splice(idx, 1); ws._queueType = null; }
    if (q.list.length === 0 && q.timer) {
      clearTimeout(q.timer); q.timer = null; q.timerStart = null;
    }
  }
}

function broadcastQueueStatus(q) {
  let countdown = -1;
  if (q.timer && q.timerStart) {
    const elapsed = (Date.now() - q.timerStart) / 1000;
    countdown = Math.max(0, Math.ceil(MATCH_COUNTDOWN_SEC - elapsed));
  }
  const data = JSON.stringify({ type: 'queue_status', count: q.list.length, max: MATCH_MAX, countdown });
  for (const p of q.list) { if (p.ws.readyState === 1) p.ws.send(data); }
}

// クライアント申告のスキンID検証（dodgeball.htmlのSKINSと対応）
const VALID_SKINS = new Set(['default', 'gold', 'sakura', 'neon', 'shadow', 'flame', 'ice']);
const cleanSkin = s => (typeof s === 'string' && VALID_SKINS.has(s)) ? s : 'default';

function startQueueMatch(q) {
  if (q.timer) { clearTimeout(q.timer); q.timer = null; q.timerStart = null; }
  if (q.list.length === 0) return;

  const matchPlayers = q.list.splice(0, MATCH_MAX);
  const key = genKey();
  const room = new GameRoom(key);
  room.isRanked = q.ranked;
  rooms.set(key, room);
  room.hostWs = matchPlayers[0].ws;

  for (const mp of matchPlayers) {
    const slot = room.assignSlot(mp.ws);
    mp.ws._room = room;
    mp.ws._slot = slot;
    mp.ws._queueType = null;
    room.clients.set(mp.ws, { slot, name: mp.name, skin: mp.skin || 'default' });
  }

  room.startGame();

  for (const [ws, info] of room.clients) {
    room.sendTo(ws, {
      type: 'match_found', key, slot: info.slot,
      players: room.getSlotList()
    });
  }

  if (q.list.length > 0) {
    q.timerStart = Date.now();
    q.timer = setTimeout(() => startQueueMatch(q), MATCH_COUNTDOWN_SEC * 1000);
    broadcastQueueStatus(q);
  }
}

/* ── Connection handling ── */

wss.on('connection', (ws) => {
  ws._room = null;
  ws._slot = -1;
  ws._queueType = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create_room': {
        const key = genKey();
        ws._room = new GameRoom(key);
        rooms.set(key, ws._room);
        ws._room.hostWs = ws;
        ws._slot = ws._room.assignSlot(ws);
        ws._room.clients.set(ws, { slot: ws._slot, name: msg.name || 'Host', skin: cleanSkin(msg.skin) });
        ws._room.sendTo(ws, {
          type: 'room_created', key, slot: ws._slot, isHost: true,
          players: ws._room.getSlotList()
        });
        break;
      }

      case 'join_room': {
        const r = rooms.get(msg.key);
        if (!r) { ws.send(JSON.stringify({ type: 'error', message: 'ルームが見つかりません' })); return; }
        if (r.clients.size >= 16) { ws.send(JSON.stringify({ type: 'error', message: 'ルームが満員です (最大16人)' })); return; }
        if (r.lobbyState === 'playing') { ws.send(JSON.stringify({ type: 'error', message: 'ゲーム中です' })); return; }
        ws._room = r;
        ws._slot = ws._room.assignSlot(ws);
        ws._room.clients.set(ws, { slot: ws._slot, name: msg.name || 'Player', skin: cleanSkin(msg.skin) });
        ws._room.sendTo(ws, {
          type: 'room_joined', key: msg.key, slot: ws._slot, isHost: false,
          players: ws._room.getSlotList()
        });
        ws._room.broadcast({
          type: 'player_joined', slot: ws._slot, name: msg.name || 'Player',
          players: ws._room.getSlotList()
        }, ws);
        break;
      }

      case 'start_game': {
        if (ws._room && ws._room.hostWs === ws && ws._room.lobbyState === 'waiting') {
          ws._room.startGame();
        }
        break;
      }

      case 'input': {
        const room = ws._room;
        if (room && (room.gameState === 'playing' || room.gameState === 'countdown')) {
          // throw/catch/jumpはワンショット入力。次のtickまでに後続パケットで
          // 上書きされると消えるため、tickで消費されるまで保持する
          const prev = room.inputs[ws._slot];
          if (prev) {
            msg.input.throw = msg.input.throw || prev.throw;
            msg.input.catch = msg.input.catch || prev.catch;
            msg.input.jump = msg.input.jump || prev.jump;
          }
          room.inputs[ws._slot] = msg.input;
        }
        break;
      }

      case 'choice_result': {
        if (ws._room && ws._room._choiceThrower && ws._room._choiceThrower.id === ws._slot) {
          ws._room.resolveChoice(msg.returnToField);
        }
        break;
      }

      case 'matchmake': {
        addToQueue(msg.ranked ? 'ranked' : 'casual', ws, msg.name || 'Player', cleanSkin(msg.skin));
        break;
      }

      case 'cancel_match': {
        removeFromAnyQueue(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws._queueType) removeFromAnyQueue(ws);
    if (!ws._room) return;
    const wasHost = ws._room.hostWs === ws;
    ws._room.removePlayer(ws);

    if (ws._room.clients.size === 0) {
      ws._room.destroy();
      rooms.delete(ws._room.key);
      return;
    }

    ws._room.broadcast({
      type: 'player_left', slot: ws._slot, wasHost,
      players: ws._room.getSlotList()
    });

    if (wasHost) {
      const [newHost] = ws._room.clients.keys();
      ws._room.hostWs = newHost;
      const info = ws._room.clients.get(newHost);
      ws._room.sendTo(newHost, { type: 'become_host', slot: info.slot });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Dodgeball server on http://localhost:${PORT}`);
});
