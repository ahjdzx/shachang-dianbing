/**
 * [INPUT]: 依赖 three 与 OrbitControls；读取演出层给的 focus（只读）和相机当前的视野、宽高比。不引用本项目的其他模块，棋盘尺寸以常量 BOUND/IDLE/TOP/SEAT 写在本文件。
 * [OUTPUT]: 导出 Director（setMode 四种模式 auto/free/top/seat、update、shake、obstacles 回调、onUserTakeover 回调）。
 * [POS]: render 的摄影师。演出层只说「现在发生什么」（focus），机位怎么摆由它决定。
 *        它不知道规则，也不知道迷雾：焦点里有什么就拍什么，所以泄密与否由给 focus 的一方把关。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// 自动导播：根据演出层的焦点选镜头，用临界阻尼弹簧平滑推拉；也支持自由视角和俯视。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// 机位活动范围：桌面上空。军棋盘比象棋盘深，所以 z 方向放得更开
const BOUND = { x: 10, z: 13.5 };
const IDLE = { radius: 16.5, height: 13.5, squash: 0.5 }; // 待机环绕：椭圆，长轴沿棋盘纵深
const SEAT = { eye: new THREE.Vector3(0, 12.5, 17), look: new THREE.Vector3(0, 0, 1.2), tall: { fit: 1.12, lean: 0.42, look: 0.5 } }; // 入座：红方棋手身后的固定机位；黑方把 z 取反
// 俯视：高度按画面算，刚好装下。纵向要装下棋盘的深度；横向在宽屏上连两侧托盘一起装，竖屏上只保棋盘
const TOP = { depth: 17.2, wide: 17, narrow: 8.7, lean: 0.094, look: new THREE.Vector3(0, 0, 0.25) };
const WIDE = Math.tan((19 * Math.PI) / 180) * 1.6; // 机位是照 16:10、38° 视野调的：那时水平半视角的正切

class Spring3 {
  constructor(v) {
    this.x = v.clone();
    this.v = new THREE.Vector3();
  }
  step(target, dt, time) {
    const w = 1 / time;
    const a = target.clone().sub(this.x).multiplyScalar(w * w).addScaledVector(this.v, -2 * w);
    this.v.addScaledVector(a, dt);
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }
  snap(v) {
    this.x.copy(v);
    this.v.set(0, 0, 0);
  }
}

export class Director {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = "auto";
    this.eye = new Spring3(new THREE.Vector3(0, 15, 16));
    this.look = new Spring3(new THREE.Vector3(0, 0, 0));
    this.orbit = 0.6;
    this.shakeAmp = 0;
    this.tilt = 0; // 0 = 画面上方是天，1 = 画面上方是棋盘远端（俯视）
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 36;
    this.controls.enabled = false;
    this.onUserTakeover = null;
    this.seatSide = "r";
    // 自动导播和入座都是「程序掌镜」：用户一动手（右键拖动或滚轮）就交还给自由视角
    const handsOff = () => this.mode === "auto" || this.mode === "seat";
    dom.addEventListener("pointerdown", (e) => {
      if (handsOff() && e.button === 2) this.setMode("free");
    });
    dom.addEventListener("wheel", () => {
      if (handsOff()) this.setMode("free");
    });
    // 触屏没有右键和滚轮：双指一碰就交给自由视角（单指留给点棋子）
    dom.addEventListener("touchstart", (e) => {
      if (handsOff() && e.touches.length >= 2) this.setMode("free");
    }, { passive: true });
  }

  // side 只对 seat 有意义：坐到哪一方身后（"r" | "b"）
  setMode(mode, side = this.seatSide) {
    this.mode = mode;
    this.seatSide = side;
    this.controls.enabled = mode === "free";
    if (mode === "free") {
      // OrbitControls 假定上方是天
      this.tilt = 0;
      this.camera.up.set(0, 1, 0);
      this.controls.target.copy(this.look.x);
      this.camera.position.copy(this.eye.x);
    }
    this.onUserTakeover?.(mode);
  }

  // 爆炸时的镜头抖动：短促、指数衰减。自由视角下不抖，免得和用户的手抢镜头
  shake(power = 1) {
    this.shakeAmp = Math.max(this.shakeAmp, 0.16 * power);
  }

  // 机位求解：在主体周围 24 个方位里挑一个——不出桌面、视线不被棋子挡、构图合适、尽量少转
  solve(subject, { dist, elev, prefer = null, sideways = false, weight = 4, exclude = [] }) {
    const here = this.eye.x.clone().sub(subject).setY(0);
    const hereAz = Math.atan2(here.x, here.z);
    const obstacles = (this.obstacles?.() || []).filter((a) => !exclude.includes(a));
    let best = null;
    for (let k = 0; k < 24; k++) {
      const az = (k / 24) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
      const eye = subject.clone().addScaledVector(dir, dist * Math.cos(elev)).setY(subject.y + dist * Math.sin(elev));
      let score = 0;
      // 出界
      const ex = Math.max(0, Math.abs(eye.x) - (BOUND.x - 0.5)) + Math.max(0, Math.abs(eye.z) - (BOUND.z - 0.5));
      score += ex * 40;
      // 遮挡：视线上有别的棋子
      for (const o of obstacles) {
        for (let i = 2; i < 12; i++) {
          const p = subject.clone().lerp(eye, i / 12);
          if (p.y > o.position.y + 1.15) break;
          if (Math.hypot(p.x - o.position.x, p.z - o.position.z) < 0.5) {
            score += 5;
            break;
          }
        }
      }
      // 构图偏好
      if (prefer) {
        const d = dir.dot(prefer);
        score += (sideways ? Math.abs(d) : 1 - d) * weight;
      }
      // 连续性：少转动
      let turn = Math.abs(az - hereAz) % (Math.PI * 2);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      score += turn * 1.5;
      if (!best || score < best.score) best = { score, eye, dir, az };
    }
    return best;
  }

  // 事件变化时重新定镜
  frame(f) {
    const up = new THREE.Vector3(0, 0.45, 0);
    if (f.kind === "move" && f.actor) {
      // 走子：斜后方跟拍。铁路上的长途奔袭把镜头拉远一些
      const dir = f.to.clone().sub(f.from).setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
      dir.normalize();
      const span = f.from.distanceTo(f.to);
      const mid = f.from.clone().lerp(f.to, 0.5);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const prefer = dir.clone().multiplyScalar(-1).addScaledVector(side, 0.7).normalize();
      const shot = this.solve(mid, { dist: 8.6 + span * 0.4, elev: 0.74, prefer, exclude: [f.actor] });
      return { offset: shot.eye.clone().sub(mid), follow: f.actor, lead: dir, time: 0.7, base: mid };
    }
    if ((f.kind === "attack" || f.kind === "blast") && f.at) {
      // 交战取侧面；爆炸站远一点，把火球和飞出去的棋子都框进来
      const blast = f.kind === "blast";
      const shot = this.solve(f.at, { dist: blast ? 8.4 : 6.6, elev: blast ? 0.66 : 0.6, prefer: f.dir, sideways: true, weight: 6, exclude: [f.actor, f.target] });
      return { eye: shot.eye, look: f.at.clone().add(up), time: 0.45 };
    }
    if (f.kind === "alarm" && f.flag) {
      // 军旗告急：把进攻的子和军旗一起框进来，从高处越过中间的棋子
      const k = f.flag.clone();
      const mid = k.clone().lerp(f.at, 0.5);
      const span = k.distanceTo(f.at);
      const toCenter = new THREE.Vector3(-k.x, 0, -k.z).normalize();
      const shot = this.solve(mid, { dist: 7.2 + span * 0.9, elev: 0.86, prefer: toCenter, weight: 4, exclude: [f.actor] });
      return { eye: shot.eye, look: mid.clone().add(up), time: 0.8 };
    }
    return null;
  }

  // 每帧：按当前镜头推拉
  update(dt, focus, playing) {
    if (this.mode === "free") {
      this.shakeAmp = 0;
      this.controls.update();
      this.eye.snap(this.camera.position);
      this.look.snap(this.controls.target);
      return;
    }
    let eye, look, time = 1.1;
    // 水平、垂直半视角的正切。竖屏比调机位时窄：跟拍和特写沿视线拉远一些（封顶 1.25 倍），免得主体挤出画面
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360), tanH = tanV * this.camera.aspect;
    const pullBack = Math.min(1.25, Math.max(1, WIDE / tanH));
    let pull = 1;
    if (this.mode === "top") {
      const height = Math.max(TOP.depth / (2 * tanV), (this.camera.aspect > 1 ? TOP.wide : TOP.narrow) / (2 * tanH));
      eye = new THREE.Vector3(0, height, TOP.look.z + height * TOP.lean);
      look = TOP.look;
      time = 0.6;
    } else if (this.mode === "seat") {
      // 人在下棋时镜头不该乱跑：固定在己方身后，自己的字和旗都正着看
      const flip = this.seatSide === "b" ? -1 : 1;
      if (this.camera.aspect < 1) {
        // 竖屏：棋盘要铺满屏宽，手指才点得准。所以坐得高、看得陡，只向自己这边稍微后仰
        const height = (SEAT.tall.fit * TOP.narrow) / (2 * tanH);
        look = new THREE.Vector3(0, 0, SEAT.tall.look * flip);
        eye = new THREE.Vector3(0, height, (SEAT.tall.look + height * SEAT.tall.lean) * flip);
      } else {
        eye = new THREE.Vector3(SEAT.eye.x, SEAT.eye.y, SEAT.eye.z * flip);
        look = new THREE.Vector3(SEAT.look.x, SEAT.look.y, SEAT.look.z * flip);
      }
      time = 0.7;
    } else {
      this.orbit += dt * (playing ? 0.05 : 0.12);
      const f = focus || { kind: "idle" };
      if (f !== this.lastFocus) {
        this.lastFocus = f;
        this.current = this.frame(f);
        if (this.current) {
          const want = this.current.eye || this.current.base.clone().add(this.current.offset);
          if (want.distanceTo(this.eye.x) > 10) {
            // 切镜：像剪辑一样直接跳到新机位
            this.eye.snap(want);
            this.look.snap(this.current.look || this.current.base);
          }
        }
      }
      const c = this.current;
      if (c && c.follow) {
        const p = c.follow.position.clone().setY(0);
        const anchor = c.base.clone().lerp(p, 0.6);
        eye = anchor.clone().add(c.offset);
        look = anchor.clone().addScaledVector(c.lead, 0.6).add(new THREE.Vector3(0, 0.35, 0));
        time = c.time;
        pull = pullBack;
      } else if (c && c.eye) {
        eye = c.eye;
        look = c.look;
        time = c.time;
        pull = pullBack;
      } else if (f.kind === "over" && f.at) {
        const r = 6;
        eye = new THREE.Vector3(f.at.x + Math.sin(this.orbit * 3) * r, 4.2, f.at.z + Math.cos(this.orbit * 3) * r);
        look = f.at.clone().add(new THREE.Vector3(0, 0.5, 0));
        time = 1.2;
      } else {
        // 横屏绕桌一圈；竖屏只在红方身后左右摆：棋盘的长边要顺着屏幕的长边，转到侧面就只剩一小条
        const az = this.camera.aspect < 1 ? Math.sin(this.orbit) * 0.5 : this.orbit;
        eye = new THREE.Vector3(Math.sin(az) * IDLE.radius * IDLE.squash, IDLE.height, Math.cos(az) * IDLE.radius);
        look = new THREE.Vector3(0, 0, 0);
        time = f.kind === "settle" ? 1.6 : 1.3;
      }
      // 机位始终留在桌面上空，并保持足够的俯角
      eye = look.clone().addScaledVector(eye.clone().sub(look), pull);
      eye.x = Math.max(-BOUND.x, Math.min(BOUND.x, eye.x));
      eye.z = Math.max(-BOUND.z, Math.min(BOUND.z, eye.z));
      const horiz = Math.hypot(eye.x - look.x, eye.z - look.z);
      eye.y = Math.max(eye.y, look.y + horiz * 0.5, 3);
      // 被夹回桌面范围后若离看点太近，就沿视线往后、往上退
      const away = eye.clone().sub(look);
      if (away.length() < 5.5) eye.copy(look).addScaledVector(away.normalize(), 5.5);
    }
    // 俯视时画面的「上」是棋盘远端，不是天：否则机位在收敛途中稍偏一点，整个画面就会歪
    this.tilt += ((this.mode === "top" ? 1 : 0) - this.tilt) * (1 - Math.exp(-dt * 6));
    this.camera.up.set(0, 1 - this.tilt, -this.tilt).normalize();
    this.camera.position.copy(this.eye.step(eye, dt, time));
    // 抖动只加在相机上，不进弹簧状态，所以抖完能准确回到原机位
    if (this.shakeAmp > 0.002) {
      const a = this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * 2 * a;
      this.camera.position.y += (Math.random() - 0.5) * 2 * a;
      this.camera.position.z += (Math.random() - 0.5) * 2 * a;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.look.step(look, dt, time * 0.8));
  }
}
