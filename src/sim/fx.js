/**
 * [INPUT]: 依赖 three；依赖 render/world 的 groundAt（粒子落地高度）。
 * [OUTPUT]: 导出 Effects（puff 扬尘、flash 闪光、blast 爆炸、update、clear）。
 * [POS]: sim 的特效。纯表现：粒子用 Math.random，不占用对局的种子随机流，也不影响任何状态。
 *        show 决定什么时候放什么，这里只管放得好看。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { groundAt } from "../render/world.js";

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DUST = new THREE.Color("#d9c3a0");
const SMOKE = new THREE.Color("#2b2622");
const up = (y) => new THREE.Vector3(0, y, 0);

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.dot = softDot();
    this.parts = [];
    const billboards = (max, material) => {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    // 扬尘和黑烟：实例化的公告板小方片，按实例着色
    this.dustMax = 500;
    this.dust = billboards(this.dustMax, new THREE.MeshBasicMaterial({ map: this.dot, transparent: true, depthWrite: false, opacity: 0.55 }));
    // 火球：叠加混合
    this.fireMax = 160;
    this.fire = billboards(this.fireMax, new THREE.MeshBasicMaterial({ map: this.dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    // 撞击闪光：点光源 + 发光片
    this.flashLight = new THREE.PointLight("#ffd28a", 0, 6, 1.6);
    scene.add(this.flashLight);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, color: "#ffe2a8", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    scene.add(this.glow);
    this.flashAge = 99;
    this.flashScale = 1;
    // 贴地冲击环
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: "#ffd9a0", transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    scene.add(this.ring);
    this.ringAge = 99;
    this.ringSize = 1;
    this.m = new THREE.Matrix4();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
  }

  puff(at, count = 26, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.4) * power;
      this.parts.push({ kind: "dust", color: DUST, p: at.clone().add(up(0.05)), v: new THREE.Vector3(Math.cos(a) * sp, 0.4 + Math.random() * 0.9 * power, Math.sin(a) * sp), age: 0, life: 0.9 + Math.random() * 0.7, size: 0.25 + Math.random() * 0.35 });
    }
  }

  flash(at, scale = 1) {
    this.flashLight.position.copy(at).add(up(0.6));
    this.glow.position.copy(at).add(up(0.5));
    this.flashAge = 0;
    this.flashScale = scale;
  }

  // 爆炸：强闪光 + 火球 + 翻滚上升的黑烟 + 贴地冲击环 + 一圈扬尘
  blast(at, power = 1) {
    this.flash(at, 1.15 * power);
    this.puff(at, Math.round(30 * power), 1.7 * power);
    for (let i = 0; i < Math.round(26 * power); i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3;
      const sp = (1.2 + Math.random() * 2.6) * power;
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 0.6, Math.sin(a) * Math.cos(e) * sp);
      this.parts.push({ kind: "fire", color: new THREE.Color().setHSL(0.05 + Math.random() * 0.07, 1, 0.55), p: at.clone().add(up(0.3)), v, age: 0, life: 0.35 + Math.random() * 0.35, size: (0.5 + Math.random() * 0.6) * power });
    }
    for (let i = 0; i < Math.round(22 * power); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * 0.9 * power;
      this.parts.push({ kind: "smoke", color: SMOKE, p: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0.3 + Math.random() * 0.4, Math.sin(a) * 0.2)), v: new THREE.Vector3(Math.cos(a) * sp, 1.2 + Math.random() * 1.6, Math.sin(a) * sp), age: 0, life: 1.3 + Math.random() * 1.1, size: (0.45 + Math.random() * 0.5) * power });
    }
    this.ring.position.set(at.x, groundAt(at.x, at.z) + 0.03, at.z);
    this.ringAge = 0;
    this.ringSize = 2.6 * power;
  }

  update(dt) {
    // 闪光：快速起，指数衰减，不会突然消失
    this.flashAge += dt;
    const env = this.flashAge < 0.05 ? this.flashAge / 0.05 : Math.exp(-(this.flashAge - 0.05) / 0.12);
    this.flashLight.intensity = 30 * env * this.flashScale;
    this.glow.material.opacity = 0.9 * env;
    this.glow.scale.setScalar((1.6 + (1 - env) * 1.4) * this.flashScale);
    // 冲击环：向外扩，边扩边淡
    this.ringAge += dt;
    const rt = Math.min(1, this.ringAge / 0.45);
    this.ring.scale.setScalar(0.2 + (1 - Math.pow(1 - rt, 3)) * this.ringSize);
    this.ring.material.opacity = 0.55 * (1 - rt);

    let nd = 0, nf = 0;
    const camQ = this.camera.quaternion;
    this.parts = this.parts.filter((pt) => (pt.age += dt) < pt.life);
    for (const pt of this.parts) {
      const t = pt.age / pt.life;
      const fire = pt.kind === "fire";
      // 扬尘受重力下沉，黑烟上升，火球很快减速
      pt.v.multiplyScalar(1 - (fire ? 5 : 2.2) * dt);
      if (pt.kind === "dust") pt.v.y -= 0.6 * dt;
      pt.p.addScaledVector(pt.v, dt);
      const g = groundAt(pt.p.x, pt.p.z) + 0.05;
      if (pt.p.y < g) pt.p.y = g;
      const size = fire ? pt.size * (1 + t) * (1 - t * t) : pt.size * (1 + t * 2.2) * (1 - t * 0.3);
      this.s.setScalar(Math.max(0.001, size * (pt.kind === "smoke" ? 1 - t * t * 0.6 : 1)));
      this.m.compose(pt.p, camQ, this.s);
      if (fire) {
        if (nf >= this.fireMax) continue;
        this.fire.setMatrixAt(nf, this.m);
        this.fire.setColorAt(nf++, this.c.copy(pt.color).multiplyScalar(1 - t));
      } else if (nd < this.dustMax) {
        this.dust.setMatrixAt(nd, this.m);
        this.dust.setColorAt(nd++, pt.color);
      }
    }
    for (const [mesh, n] of [[this.dust, nd], [this.fire, nf]]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.parts = [];
    this.flashAge = 99;
    this.ringAge = 99;
  }
}
