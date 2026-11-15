/**
 * [INPUT]: 依赖 three；依赖 engine/junqi 的 fileOf/rankOf；依赖 render/world 的 toWorld/traySlot；
 *          依赖 render/figures 的 createFigure/setCloaked/idle/flagTo/flutter/BLOCK；依赖本目录的 physics 与 fx。
 * [OUTPUT]: 导出 Stage（reset、muster、perform、update、on、applyCloaks、actors、focus、windYaw、flagTilt、busy）。
 * [POS]: sim 的导演台，演出层对外的唯一入口。它把引擎已经判定的一步棋演出来：只读走法记录，从不写回对局。
 *        爆炸、挖雷这类会暴露兵种的演出，只在相应棋子没蒙布时才放；蒙着布就只按胜负演通用动作。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// 每一步是一个协程（生成器），由 update(dt) 推进；暂停时 dt 为 0，一切静止。
import * as THREE from "three";
import { fileOf, rankOf } from "../engine/junqi.js";
import { toWorld, traySlot } from "../render/world.js";
import { createFigure, setCloaked, idle, flagTo, flutter, BLOCK } from "../render/figures.js";
import { Body, World } from "./physics.js";
import { Effects } from "./fx.js";

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
function* wait(sec) {
  let e = 0;
  while (e < sec) e += yield;
}
function* tween(sec, fn) {
  let e = 0;
  fn(0);
  while (e < sec) {
    e += yield;
    fn(clamp01(e / sec));
  }
}
const yawTo = (dir) => Math.atan2(dir.x, dir.z);
function shortestYaw(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}
const at = (s) => toWorld(fileOf(s), rankOf(s));

const RAIL_SPEED = 4.4; // 铁路：像列车一样平滑
const ROAD_SPEED = 1.3; // 公路：迈步
const STANDOFF = 0.85; // 交战时进攻方停在对方面前的距离
const CLEAR = 1.0; // 走子时与静止棋子的最小中心距，不足就请对方让一让

// 走子轨道：折线的拐角用二次曲线抹圆，直线段保持笔直
function trackOf(pts) {
  const key = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = p.clone().sub(pts[i - 1]).normalize(), b = pts[i + 1].clone().sub(p).normalize();
    return a.dot(b) < 0.999;
  });
  if (key.length === 2) return new THREE.LineCurve3(key[0], key[1]);
  const path = new THREE.CurvePath();
  let from = key[0];
  const line = (a, b) => a.distanceTo(b) > 1e-4 && path.add(new THREE.LineCurve3(a, b));
  for (let i = 1; i < key.length - 1; i++) {
    const c = key[i];
    const r = Math.min(0.38, c.distanceTo(key[i - 1]) / 2, c.distanceTo(key[i + 1]) / 2);
    const a = c.clone().addScaledVector(c.clone().sub(key[i - 1]).normalize(), -r);
    const b = c.clone().addScaledVector(key[i + 1].clone().sub(c).normalize(), r);
    line(from, a);
    path.add(new THREE.QuadraticBezierCurve3(a, c, b));
    from = b;
  }
  line(from, key[key.length - 1]);
  return path;
}

export class Stage {
  constructor(scene, camera, trays, rng) {
    this.scene = scene;
    this.trays = trays;
    this.fx = new Effects(scene, camera);
    this.world = new World();
    this.actors = new Map(); // 格子 → 人偶，只含站在棋盘上的
    this.loose = []; // 正在倒地或被移走的
    this.tasks = [];
    this.rng = rng;
    this.focus = { kind: "idle" };
    this.listeners = [];
    this.time = 0;
    this.wind = 1;
    this.windYaw = null;
    this.flagTilt = 0; // 旗面后仰角，由总控按镜头俯角给
    this.movers = new Set();
  }

  on(fn) {
    this.listeners.push(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  reset(board, rng) {
    if (rng) this.rng = rng;
    for (const a of this.actors.values()) this.scene.remove(a);
    for (const a of this.movers) this.scene.remove(a);
    for (const l of this.loose) this.scene.remove(l.actor);
    for (const t of Object.values(this.trays)) {
      for (const a of t.pieces || []) this.scene.remove(a);
      t.pieces = [];
      t.count = 0;
    }
    this.actors.clear();
    this.movers.clear();
    this.loose = [];
    this.tasks = [];
    this.world = new World();
    this.fx.clear();
    for (let s = 0; s < board.length; s++) {
      if (!board[s]) continue;
      const a = createFigure(board[s]);
      a.position.copy(at(s));
      a.userData.home = a.position.clone();
      a.userData.offset = new THREE.Vector3();
      this.scene.add(a);
      this.actors.set(s, a);
    }
    this.focus = { kind: "idle" };
  }

  // 点兵：开局前，一方的棋子从现在的位置走到新阵。棋子还是那些棋子，只是换了格子：
  // 按兵种配对，actors 表当场改好，动画随后追上——每个子起一个小跳，错开出发。
  // 连点几次阵型时，旧的一轮让位给新的一轮，棋子从半空直接改道。
  muster(board, color) {
    const olds = new Map();
    for (const [s, a] of this.actors) {
      if (a.userData.color !== color) continue;
      if (!olds.has(a.userData.code)) olds.set(a.userData.code, []);
      olds.get(a.userData.code).push([s, a]);
    }
    for (const list of olds.values()) for (const [s] of list) this.actors.delete(s);
    const round = (this.round = (this.round || 0) + 1);
    let order = 0;
    for (const [code, list] of olds) {
      const seats = [];
      for (let s = 0; s < board.length; s++) if (board[s] === code) seats.push(s);
      list.sort((x, y) => x[0] - y[0]).forEach(([, a], i) => {
        this.actors.set(seats[i], a);
        const goal = at(seats[i]);
        if (a.position.distanceTo(goal) > 0.01) this.run(this.hop(a, goal, round, order++ * 0.03));
      });
    }
  }

  *hop(actor, goal, round, delay) {
    const u = actor.userData;
    u.moving = true;
    if (!this.calm) yield* wait(delay); // calm：系统要求减少动态效果，棋子直接到位
    const from = actor.position.clone();
    const lift = 0.3 + from.distanceTo(goal) * 0.1;
    yield* tween(this.calm ? 0 : 0.5, (t) => {
      if (this.round !== round) return;
      const e = ease(t);
      actor.position.lerpVectors(from, goal, e).setY(Math.sin(Math.PI * e) * lift);
    });
    if (this.round !== round) return; // 新一轮已经接手这个子
    actor.position.copy(goal);
    u.home = goal.clone();
    u.offset.set(0, 0, 0);
    u.moving = false;
  }

  // 迷雾：fn(格子号, 编码) 返回 true 表示对当前观众隐藏。只管站着的棋子；走着的、倒下的保持原样
  applyCloaks(fn) {
    for (const [s, a] of this.actors) setCloaked(a, !!fn(s, a.userData.code));
  }

  run(gen, done) {
    gen.next();
    this.tasks.push({ gen, done });
  }

  get busy() {
    return this.tasks.length > 0;
  }

  // dt 是对局时间（暂停时为 0）；real 是真实时间。暂停时棋局静止，但镜头还在动，旗面得继续朝向它
  update(dt, real = dt) {
    this.time += dt;
    for (const task of this.tasks.slice()) {
      const r = task.gen.next(dt);
      if (r.done) {
        this.tasks.splice(this.tasks.indexOf(task), 1);
        task.done?.(r.value);
      }
    }
    this.world.standing = [...this.actors.values()].filter((a) => !a.userData.moving).map((a) => ({ position: a.position, actor: a }));
    if (dt > 0) this.world.step(dt);
    for (const a of this.actors.values()) {
      if (dt > 0) idle(a, this.time, dt, this.wind, this.windYaw, this.flagTilt);
      // 给路过的棋子让位后，弹回原位
      const u = a.userData;
      if (!u.moving && u.home) {
        u.offset.multiplyScalar(Math.exp(-dt * 5));
        a.position.copy(u.home).add(u.offset);
      }
    }
    if (dt === 0 && real > 0) for (const a of [...this.actors.values(), ...this.movers]) flagTo(a, real, this.windYaw, this.flagTilt);
    // 正在走的棋子旗子也照常飘
    if (dt > 0)
      for (const a of this.movers) {
        flagTo(a, dt, this.windYaw, this.flagTilt);
        flutter(a.userData.flag, this.time, this.wind);
      }
    this.fx.update(dt);
  }

  // ---- 一步棋的演出 -------------------------------------------------------------------
  perform(entry, extras = {}) {
    return new Promise((resolve) => this.run(this.moveShow(entry, extras), resolve));
  }

  *moveShow(entry, extras) {
    const actor = this.actors.get(entry.from);
    if (!actor) return;
    const target = entry.target ? this.actors.get(entry.to) : null;
    const u = actor.userData;
    const pts = entry.path.map(at);
    const end = pts[pts.length - 1];
    this.actors.delete(entry.from);
    u.moving = true;
    this.movers.add(actor);
    this.focus = { kind: "move", actor, from: pts[0], to: end };
    this.emit({ type: "move-start", entry, actor });

    const alive = target ? yield* this.clash(entry, actor, target, pts) : (yield* this.travel(actor, pts, entry.rail), true);
    if (alive) {
      yield* this.face(actor, u.baseYaw, 0.25);
      actor.position.copy(end);
      u.home = end.clone();
      u.offset.set(0, 0, 0);
      u.moving = false;
      this.actors.set(entry.to, actor);
    }
    this.movers.delete(actor);
    const flag = alive && Number.isInteger(extras.alarm) ? at(extras.alarm) : null;
    this.focus = flag ? { kind: "alarm", actor, at: end, flag } : { kind: "settle", actor: alive ? actor : target, at: end };
    this.emit({ type: "move-end", entry, actor });
    // 等阵亡的子倒地并被收走
    while (this.loose.length) yield;
  }

  *face(actor, yaw, sec = 0.2) {
    const y0 = actor.rotation.y;
    const y1 = shortestYaw(y0, yaw);
    if (Math.abs(y1 - y0) < 0.01) return;
    yield* tween(sec, (t) => (actor.rotation.y = y0 + (y1 - y0) * ease(t)));
  }

  // 沿轨道走：铁路上平滑滑行、身子前倾、车后带土；公路上迈步起伏
  *travel(actor, pts, rail) {
    const u = actor.userData;
    const curve = trackOf(pts);
    const length = curve.getLength();
    if (length < 0.02) return;
    // 炸弹坐木橇，走公路也是滑的、也更慢。蒙着布时不能这样：步态本身就会泄密
    const sled = u.type === "B" && !u.cloaked;
    const glide = rail || sled;
    const dur = Math.max(0.45, length / (rail ? RAIL_SPEED : sled ? 1.0 : ROAD_SPEED));
    yield* this.face(actor, yawTo(curve.getTangentAt(0.001)), 0.22);
    const body = u.body;
    let dusted = 0;
    yield* tween(dur, (t) => {
      const s = ease(t);
      actor.position.copy(curve.getPointAt(s));
      actor.rotation.y = shortestYaw(actor.rotation.y, yawTo(curve.getTangentAt(Math.min(0.999, Math.max(0.001, s)))));
      if (glide) {
        body.rotation.x = 0.14 * Math.sin(Math.PI * s) * (rail ? 1 : 0.4);
        if (rail && s * length - dusted > 0.7 && t < 0.92) {
          dusted = s * length;
          this.fx.puff(actor.position, 3, 0.35);
        }
      } else {
        const steps = Math.max(2, Math.round(length * 3));
        body.position.y = BLOCK.h + Math.abs(Math.sin(Math.PI * steps * s)) * 0.07;
        body.rotation.z = Math.sin(Math.PI * steps * s) * 0.08;
      }
      this.makeWay(actor);
    });
    body.position.y = BLOCK.h;
    body.rotation.x = 0;
    body.rotation.z = 0;
  }

  // 让路：离移动棋子太近的静止棋子被轻推开，过后弹回，保证不穿模
  makeWay(mover) {
    for (const o of this.actors.values()) {
      const u = o.userData;
      if (u.moving || !u.home) continue;
      const d = new THREE.Vector3(u.home.x - mover.position.x, 0, u.home.z - mover.position.z);
      const dist = d.length();
      if (dist < CLEAR) {
        d.multiplyScalar(1 / (dist || 1));
        const need = CLEAR - dist;
        if (need > u.offset.length()) u.offset.copy(d).multiplyScalar(need);
        o.position.copy(u.home).add(u.offset);
      }
    }
  }

  // ---- 交战 ---------------------------------------------------------------------------
  // 返回进攻方是否还活着。胜负早由引擎定了，这里只决定怎么演。
  *clash(entry, actor, target, pts) {
    const u = actor.userData, tu = target.userData;
    const end = pts[pts.length - 1];
    const dir = end.clone().sub(pts[pts.length - 2]).setY(0).normalize();
    const back = dir.clone().negate();
    // 走到对方面前停下
    const lead = [...pts.slice(0, -1), end.clone().addScaledVector(dir, -STANDOFF)];
    if (lead[0].distanceTo(lead[lead.length - 1]) > 0.2 || lead.length > 2) yield* this.travel(actor, lead, entry.rail);
    else yield* this.face(actor, yawTo(dir));
    u.moving = true;

    // 会暴露兵种的演出，只在那个棋子没蒙布时才放
    const result = entry.result;
    const bomb = result === "tie" && ((u.type === "B" && !u.cloaked) || (tu.type === "B" && !tu.cloaked));
    const mine = result === "lose" && tu.type === "M" && !tu.cloaked;
    const dig = result === "win" && u.type === "1" && tu.type === "M" && !u.cloaked && !tu.cloaked;
    this.focus = { kind: bomb || mine ? "blast" : "attack", actor, target, at: end.clone(), dir };
    const leave = () => this.actors.delete(entry.to);

    if (bomb) {
      // 炸弹：引信烧到头，两个一起上天
      yield* wait(0.3);
      this.blast(end.clone().addScaledVector(dir, -STANDOFF / 2), "bomb", 1.4);
      leave();
      for (const [a, away] of [[actor, back], [target, dir]]) a.userData.type === "B" && !a.userData.cloaked ? this.vanish(a) : this.knock(a, away, 8, 5);
      return false;
    }
    if (mine) {
      // 踩雷：一脚踏上去，自己被炸飞，雷还在
      const p0 = actor.position.clone();
      yield* tween(0.16, (t) => actor.position.copy(p0).addScaledVector(dir, 0.3 * ease(t)));
      this.blast(end.clone().addScaledVector(dir, -0.3), "mine", 1.1);
      this.jolt(target, dir, 1.5);
      this.knock(actor, back, 7.5, 5.5);
      return false;
    }
    if (dig) {
      // 工兵排雷：铲两下，把雷掀走
      for (let i = 0; i < 2; i++) yield* this.strike(actor, () => this.fx.puff(end.clone().addScaledVector(dir, -0.3), 10, 0.6));
      this.emit({ type: "dig" });
      this.knock(target, dir, 3.2, 4.2);
      leave();
    } else if (result === "win" || result === "flag") {
      yield* this.strike(actor, () => this.knock(target, dir, 5.5));
      leave();
      if (result === "flag") this.emit({ type: "flag", actor });
    } else if (result === "lose") {
      // 出招不成，被对方反手打飞
      yield* this.strike(actor, () => this.jolt(target, dir, 1));
      yield* this.face(target, yawTo(back), 0.15);
      yield* this.strike(target, () => this.knock(actor, back, 5.5));
      this.run(this.face(target, tu.baseYaw, 0.3));
      return false;
    } else {
      // 同归于尽：双方同时出招，双双倒地
      yield* this.face(target, yawTo(back), 0.15);
      this.run(this.strike(target, () => {}));
      yield* this.strike(actor, () => {
        leave();
        this.knock(target, dir, 5);
        this.knock(actor, back, 5);
      });
      return false;
    }
    u.moving = true;
    yield* this.travel(actor, [actor.position.clone(), end], false);
    return true;
  }

  // 出招：军刀和指挥棒劈、刺刀捅、枪开火、铁锹铲；蒙着布或没有武器的，整个身子往前一顶
  *strike(actor, hit) {
    const u = actor.userData;
    const body = u.body;
    const { weapon: w, kind, tip } = u.parts;
    let fired = false;
    const fire = (t, when = 0.6) => {
      if (t <= when || fired) return;
      fired = true;
      hit();
    };
    if (u.cloaked || !w || kind === "none") {
      yield* tween(0.16, (t) => (body.position.z = -0.08 * ease(t)));
      yield* tween(0.1, (t) => {
        body.position.z = -0.08 + 0.36 * ease(t);
        fire(t);
      });
      yield* tween(0.24, (t) => (body.position.z = 0.28 * (1 - ease(t))));
      return;
    }
    const rx = w.rotation.x, pz = w.position.z;
    if (kind === "slash") {
      yield* tween(0.2, (t) => {
        w.rotation.x = rx - 0.7 * ease(t);
        body.rotation.x = -0.12 * t;
      });
      yield* tween(0.11, (t) => {
        w.rotation.x = rx - 0.7 + 2.2 * ease(t);
        body.rotation.x = -0.12 + 0.32 * t;
        fire(t);
      });
      yield* tween(0.28, (t) => {
        w.rotation.x = rx + 1.5 * (1 - ease(t));
        body.rotation.x = 0.2 * (1 - t);
      });
      return;
    }
    // 端平
    const level = Math.PI / 2 - rx;
    yield* tween(0.22, (t) => (w.rotation.x = rx + level * ease(t)));
    if (kind === "shoot") {
      // 开火：枪口一闪，后坐
      w.updateWorldMatrix(true, false);
      const muzzle = w.localToWorld(new THREE.Vector3(0, tip, 0));
      this.fx.flash(muzzle.setY(muzzle.y - 0.5), 0.45);
      hit();
      yield* tween(0.07, (t) => (w.position.z = pz - 0.07 * t));
      yield* tween(0.2, (t) => (w.position.z = pz - 0.07 * (1 - t)));
    } else {
      yield* tween(0.1, (t) => {
        w.position.z = pz + 0.24 * ease(t);
        body.position.z = 0.1 * ease(t);
        fire(t);
      });
      yield* tween(0.2, (t) => {
        w.position.z = pz + 0.24 * (1 - ease(t));
        body.position.z = 0.1 * (1 - ease(t));
      });
    }
    yield* tween(0.22, (t) => (w.rotation.x = rx + level * (1 - ease(t))));
  }

  // 站着的棋子挨了一下：晃一晃，不离格
  jolt(target, dir, power) {
    target.userData.wobbleV.x += -dir.x * power * 2;
    target.userData.wobbleV.y += dir.z * power * 2;
  }

  blast(at, kind, power) {
    this.fx.blast(at, power);
    this.emit({ type: "blast", kind, power });
  }

  // 炸弹自己：在火球里没了影；等烟散开，再从烟里落进己方的盒子
  vanish(actor) {
    this.movers.delete(actor);
    actor.userData.moving = true;
    const rec = { actor };
    this.loose.push(rec);
    const s0 = actor.scale.x;
    const self = this;
    this.run(
      (function* () {
        yield* tween(0.1, (t) => actor.scale.setScalar(Math.max(0.001, s0 * (1 - t))));
        yield* wait(0.9);
        yield* self.stow(rec);
      })(),
    );
  }

  // 被打飞：交给刚体模拟，之后收走
  knock(target, dir, power, lift = 3.2) {
    const at = target.position.clone();
    this.fx.flash(at);
    this.fx.puff(at, 18, 0.8);
    const v = dir.clone().multiplyScalar(power * (0.8 + this.rng() * 0.4)).add(new THREE.Vector3(0, lift + this.rng() * 1.5, 0));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const spin = side.multiplyScalar(-(5 + this.rng() * 5)).add(new THREE.Vector3(0, (this.rng() - 0.5) * 6, 0));
    target.userData.moving = true;
    this.movers.delete(target);
    const rec = { actor: target, body: this.world.add(new Body(target, v, spin)) };
    this.loose.push(rec);
    this.emit({ type: "knock", actor: target });
    this.run(this.cleanup(rec));
  }

  *cleanup(rec) {
    // 等它倒下、静止（最多 3.5 秒）
    let t = 0;
    while (!rec.body.asleep && t < 3.5) t += yield;
    yield* wait(0.45);
    this.world.remove(rec.body);
    yield* this.stow(rec);
  }

  // 收子：抬离桌面、扶正、缩小，摆进同色的盒子（红子进红盒，黑子进黑盒）。
  // 离开棋盘的子都走这一步，没有例外：盒子里有几个，这一方就丢了几个。
  *stow(rec) {
    const a = rec.actor;
    const tray = this.trays[a.userData.color];
    const slot = traySlot(tray, tray.count++);
    const p0 = a.position.clone();
    const q0 = a.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a.userData.baseYaw, 0));
    const s0 = a.scale.x;
    yield* tween(1.0, (k) => {
      const e = ease(k);
      a.position.lerpVectors(p0, slot, e);
      a.position.y += Math.sin(Math.PI * e) * 2.2;
      a.quaternion.slerpQuaternions(q0, q1, Math.min(1, e * 1.4));
      a.scale.setScalar(s0 + (0.55 - s0) * e);
    });
    tray.pieces.push(a);
    this.loose.splice(this.loose.indexOf(rec), 1);
  }
}
