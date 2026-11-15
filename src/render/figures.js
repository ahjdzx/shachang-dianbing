/**
 * [INPUT]: 依赖 three；依赖 engine/junqi 的 NAMES（两字名）与 GLYPH（单字）。
 * [OUTPUT]: 导出 BLOCK（木块尺寸）、createFigure、setCloaked、idle、flagTo、flutter。
 * [POS]: render 的棋子工厂。十二个兵种的造型只在这里定义；sim/show 拿到 actor 后只动它的位置、朝向和 parts。
 *        迷雾也在这里收口：蒙布后的棋子外形完全相同，个头、旗子、木块都不泄露兵种。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// 两支玩具军队：每个棋子是一块军棋木块（顶面印两字名），上面站一个小人偶，背后插一面写着单字的小旗。
// 人偶的局部前方是 +Z；红方整体转 180° 面向黑方。
import * as THREE from "three";
import { NAMES, GLYPH } from "../engine/junqi.js";

export const BLOCK = { w: 0.9, d: 0.56, h: 0.16 };

const ARMY = {
  r: { primary: "#c0392b", dark: "#7d1f16", trim: "#f2c14e", text: "#b0221a", flag: "#d23b2f", ink: "#fff2c8", tent: "#9a3b2d" },
  b: { primary: "#2d3e50", dark: "#141c25", trim: "#c7ced6", text: "#151515", flag: "#25313e", ink: "#f2f2f2", tent: "#3b4958" },
};
const SKIN = "#f1c9a5";
const WOOD = "#8a5a2b";
const STEEL = "#d9dde2";
const KAI = `"STKaiti","Kaiti SC","KaiTi","STSong","Songti SC",serif`;
// 军衔越高个头越大
const SCALE = { 9: 1.16, 8: 1.1, 7: 1.04, 6: 1.0, 5: 0.97, 4: 0.94, 3: 0.92, 2: 0.9, 1: 0.88, B: 1, M: 1, F: 1 };
const MAST = { x: -0.33, z: -0.17, h: 0.98, fw: 0.33, fh: 0.26 };

// ---- 缓存：50 个棋子共用同一批几何体、材质和贴图 ---------------------------------------
const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};
const mat = (color, rough = 0.55, metal = 0, side = THREE.FrontSide) =>
  memo(`m${color}${rough}${metal}${side}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side }));
const cyl = (rt, rb, h, seg = 12) => memo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r, seg = 12) => memo(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))));
const box = (w, h, d) => memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cone = (r, h, seg = 10) => memo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// 字贴图：label 是木块顶面的两字名，flag 是旗面的单字
function charTexture(color, text, mode) {
  return memo(`t${color}${text}${mode}`, () => {
    const a = ARMY[color];
    const c = document.createElement("canvas");
    c.width = mode === "label" ? 320 : 256;
    c.height = mode === "label" ? 192 : 256;
    const g = c.getContext("2d");
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (mode === "label") {
      g.fillStyle = "#ecd3a0";
      g.fillRect(0, 0, 320, 192);
      g.strokeStyle = a.text;
      g.lineWidth = 12;
      g.strokeRect(12, 12, 296, 168);
      g.fillStyle = a.text;
      g.font = `bold ${text.length > 1 ? 124 : 140}px ${KAI}`;
      g.fillText(text, 160, 104);
    } else {
      g.fillStyle = a.flag;
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = a.trim;
      g.lineWidth = 14;
      g.strokeRect(10, 10, 236, 236);
      g.fillStyle = a.ink;
      g.font = `bold 150px ${KAI}`;
      g.fillText(text, 128, 138);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}
const labelMat = (color, text) => memo(`L${color}${text}`, () => new THREE.MeshStandardMaterial({ map: charTexture(color, text, "label"), roughness: 0.5 }));
// 旗面两张材质：正面贴正字，背面贴左右翻转的字，从背后看也是正字
const flagMats = (color, text) =>
  memo(`F${color}${text}`, () => {
    const tex = charTexture(color, text, "flag");
    const flipped = tex.clone();
    flipped.wrapS = THREE.RepeatWrapping;
    flipped.repeat.x = -1;
    flipped.offset.x = 1;
    flipped.needsUpdate = true;
    return {
      front: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.FrontSide }),
      back: new THREE.MeshStandardMaterial({ map: flipped, roughness: 0.8, side: THREE.BackSide }),
    };
  });

// 一面能飘动的旗：两张背靠背的平面。几何体每面旗独有（顶点逐帧摆动），材质共用
function makeFlag(color, text, w, h) {
  const geo = new THREE.PlaneGeometry(w, h, 8, 3);
  geo.translate(w / 2, 0, 0);
  const m = flagMats(color, text);
  const front = new THREE.Mesh(geo, m.front);
  const back = new THREE.Mesh(geo, m.back);
  front.castShadow = true;
  const g = new THREE.Group();
  g.add(front, back);
  g.userData.flag = { geo, base: geo.attributes.position.array.slice(), w, phase: Math.random() * 6, front, back };
  return g;
}

// 木块：圆角矩形拉伸，上下各带一圈倒角
const blockGeo = () =>
  memo("block", () => {
    const { w, d, h } = BLOCK;
    const r = 0.07, bevel = 0.022;
    const x = w / 2 - bevel, y = d / 2 - bevel;
    const s = new THREE.Shape();
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y);
    s.quadraticCurveTo(x, -y, x, -y + r);
    s.lineTo(x, y - r);
    s.quadraticCurveTo(x, y, x - r, y);
    s.lineTo(-x + r, y);
    s.quadraticCurveTo(-x, y, -x, y - r);
    s.lineTo(-x, -y + r);
    s.quadraticCurveTo(-x, -y, -x + r, -y);
    const geo = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel, 0);
    return geo;
  });

// ---- 军官与士兵：同一副骨架，靠帽子、披风、肩章和手里的东西区分军衔 -------------------------
const WEAPONS = {
  // 指挥棒：举在身前
  baton(a) {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.02, 0.02, 0.3, 8), mat(a.trim, 0.3, 0.7), 0, 0.1, 0), mesh(sph(0.034, 8), mat(a.trim, 0.3, 0.7), 0, 0.26, 0));
    g.position.set(0.19, 0.34, 0.08);
    g.rotation.x = 0.35;
    return { weapon: g, kind: "slash" };
  },
  sabre(a) {
    const g = new THREE.Group();
    g.add(mesh(box(0.028, 0.42, 0.012), mat(STEEL, 0.25, 0.9), 0, 0.2, 0), mesh(box(0.11, 0.025, 0.04), mat(a.trim, 0.3, 0.6), 0, 0, 0));
    g.position.set(0.2, 0.3, 0.08);
    g.rotation.z = -0.25;
    return { weapon: g, kind: "slash" };
  },
  pistol() {
    const g = new THREE.Group();
    g.add(mesh(box(0.035, 0.16, 0.035), mat("#1c1c1e", 0.4, 0.5), 0, 0.08, 0), mesh(box(0.035, 0.035, 0.09), mat("#1c1c1e", 0.4, 0.5), 0, 0.015, -0.03));
    g.position.set(0.17, 0.36, 0.1);
    g.rotation.x = 0.5;
    return { weapon: g, kind: "shoot", tip: 0.18 };
  },
  rifle(a, bayonet) {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.015, 0.02, 0.62, 6), mat(WOOD, 0.6), 0, 0.2, 0));
    if (bayonet) g.add(mesh(cone(0.022, 0.16, 6), mat(STEEL, 0.25, 0.9), 0, 0.59, 0));
    g.position.set(0.17, 0.24, 0.06);
    return { weapon: g, kind: bayonet ? "thrust" : "shoot", tip: 0.52 };
  },
  shovel() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.014, 0.014, 0.5, 6), mat(WOOD, 0.6), 0, 0.2, 0), mesh(box(0.1, 0.13, 0.014), mat(STEEL, 0.35, 0.8), 0, 0.5, 0));
    g.position.set(0.18, 0.22, 0.06);
    return { weapon: g, kind: "slash" };
  },
};

function trooper(a, g, o) {
  const great = o.coat === "great";
  if (great) g.add(mesh(cyl(0.11, 0.19, 0.44), mat(a.primary), 0, 0.22, 0));
  else {
    g.add(mesh(cyl(0.05, 0.056, 0.2, 8), mat(a.dark), -0.06, 0.1, 0), mesh(cyl(0.05, 0.056, 0.2, 8), mat(a.dark), 0.06, 0.1, 0));
    g.add(mesh(cyl(0.105, 0.125, 0.28), mat(a.primary), 0, 0.33, 0));
  }
  if (o.belt) g.add(mesh(cyl(0.132, 0.132, 0.035), mat(a.trim, 0.4, 0.3), 0, 0.27, 0));
  if (o.cape) g.add(mesh(memo("cape", () => new THREE.CylinderGeometry(0.19, 0.27, 0.44, 12, 1, true, Math.PI * 0.55, Math.PI * 0.9)), mat(a.dark, 0.55, 0, THREE.DoubleSide), 0, 0.23, 0));
  if (o.epaulettes) g.add(mesh(box(0.08, 0.025, 0.09), mat(a.trim, 0.3, 0.6), -0.13, 0.455, 0), mesh(box(0.08, 0.025, 0.09), mat(a.trim, 0.3, 0.6), 0.13, 0.455, 0));
  g.add(mesh(sph(0.09), mat(SKIN), 0, 0.54, 0));
  if (o.hat === "helmet") {
    g.add(mesh(memo("helmet", () => new THREE.SphereGeometry(0.108, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mat(o.helmet || "#55604f", 0.5, 0.3), 0, 0.555, 0));
    g.add(mesh(cyl(0.125, 0.125, 0.014), mat(o.helmet || "#55604f", 0.5, 0.3), 0, 0.558, 0));
  } else {
    // 大檐帽上宽下窄，野战帽是直筒
    const peak = o.hat === "peak";
    g.add(mesh(peak ? cyl(0.125, 0.09, 0.075) : cyl(0.09, 0.095, 0.075), mat(peak ? a.dark : a.primary), 0, 0.648, 0));
    g.add(mesh(box(0.13, 0.014, 0.07), mat("#17171a", 0.4), 0, 0.615, 0.095));
    if (o.badge) g.add(mesh(sph(0.026, 8), mat(a.trim, 0.3, 0.7), 0, 0.655, 0.105));
  }
  if (o.binoculars) g.add(mesh(box(0.1, 0.05, 0.055), mat("#17171a", 0.4, 0.3), 0, 0.43, 0.115));
  if (o.pack) g.add(mesh(box(0.17, 0.19, 0.09), mat("#6b5a3a", 0.8), 0, 0.36, -0.14));
  const arm = WEAPONS[o.weapon](a, o.bayonet);
  g.add(arm.weapon);
  return arm;
}

const OFFICER = {
  9: { hat: "peak", coat: "great", cape: true, epaulettes: true, badge: true, belt: true, weapon: "baton" },
  8: { hat: "peak", cape: true, epaulettes: true, badge: true, belt: true, weapon: "sabre" },
  7: { hat: "peak", epaulettes: true, badge: true, binoculars: true, weapon: "pistol" },
  6: { hat: "peak", belt: true, badge: true, weapon: "sabre" },
  5: { hat: "field", belt: true, weapon: "sabre" },
  4: { hat: "field", belt: true, weapon: "pistol" },
  3: { hat: "helmet", weapon: "rifle", bayonet: true },
  2: { hat: "helmet", weapon: "rifle" },
  1: { hat: "helmet", helmet: "#e0b53a", pack: true, weapon: "shovel" },
};

// 炸弹：小木橇上一颗卡通圆炸弹，引信头上有火星
function bomb(a, g) {
  g.add(mesh(box(0.36, 0.045, 0.46), mat(WOOD, 0.65), 0, 0.075, 0));
  for (const s of [-1, 1]) g.add(mesh(box(0.045, 0.05, 0.54), mat(a.dark, 0.6), s * 0.15, 0.028, 0));
  const ball = mesh(sph(0.2, 16), mat("#1b1c20", 0.25, 0.5), 0, 0.3, 0);
  g.add(ball);
  g.add(mesh(cyl(0.05, 0.06, 0.07, 8), mat(a.trim, 0.35, 0.6), 0, 0.51, 0));
  const fuse = mesh(cyl(0.012, 0.012, 0.16, 5), mat("#c9b48a", 0.9), 0.03, 0.61, 0);
  fuse.rotation.z = -0.35;
  g.add(fuse);
  const spark = new THREE.Mesh(sph(0.035, 6), memo("spark", () => new THREE.MeshBasicMaterial({ color: "#ffb347" })));
  spark.position.set(0.06, 0.69, 0);
  g.add(spark);
  g.add(mesh(cyl(0.205, 0.205, 0.03, 16), mat(a.primary, 0.5), 0, 0.3, 0));
  return { weapon: ball, kind: "none", spark };
}

// 地雷：带触角的扁圆雷，周围一圈沙袋
function mine(a, g) {
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    const bag = mesh(sph(0.1, 8), mat("#b9a57a", 0.95), Math.cos(t) * 0.2, 0.05, Math.sin(t) * 0.17);
    bag.scale.set(1, 0.55, 0.8);
    bag.rotation.y = -t;
    g.add(bag);
  }
  g.add(mesh(cyl(0.15, 0.17, 0.1, 14), mat("#3f4a37", 0.5, 0.4), 0, 0.12, 0));
  g.add(mesh(cyl(0.155, 0.155, 0.02, 14), mat(a.primary, 0.5), 0, 0.12, 0));
  const cap = mesh(sph(0.09, 10), mat("#2c3427", 0.45, 0.5), 0, 0.17, 0);
  cap.scale.y = 0.55;
  g.add(cap);
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2 + 0.5;
    g.add(mesh(cyl(0.012, 0.012, 0.09, 5), mat(a.trim, 0.3, 0.7), Math.cos(t) * 0.09, 0.2, Math.sin(t) * 0.09));
  }
  return { kind: "none" };
}

// 军旗：石座上一面大旗
function banner(a, g, color) {
  g.add(mesh(box(0.4, 0.09, 0.36), mat("#8f8a80", 0.9), 0, 0.045, 0), mesh(box(0.28, 0.09, 0.26), mat("#a39d92", 0.9), 0, 0.135, 0));
  g.add(mesh(cyl(0.018, 0.022, 1.32, 6), mat(WOOD), 0, 0.84, 0));
  g.add(mesh(sph(0.04, 8), mat(a.trim, 0.3, 0.7), 0, 1.52, 0));
  const flag = makeFlag(color, GLYPH.F, 0.66, 0.46);
  flag.position.set(0, 1.25, 0);
  g.add(flag);
  return { kind: "none", banner: flag };
}

// 蒙布：一顶小军帐，谁蒙上都一个样
function tent(a, g) {
  g.add(mesh(cone(0.27, 0.52, 10), mat(a.tent, 0.85), 0, 0.26, 0));
  g.add(mesh(cyl(0.285, 0.29, 0.035, 10), mat(a.trim, 0.45, 0.3), 0, 0.02, 0));
  g.add(mesh(sph(0.04, 8), mat(a.trim, 0.3, 0.6), 0, 0.54, 0));
}

export function createFigure(code) {
  const color = code[0];
  const type = code[1];
  const a = ARMY[color];
  const root = new THREE.Group(); // 原点在木块底面中心
  root.add(mesh(blockGeo(), mat(color === "r" ? "#c99a5b" : "#b08a58", 0.5)));
  // 顶面的字朝向主人：主人站在人偶背后（局部 -Z）
  const label = new THREE.Mesh(memo("label", () => new THREE.PlaneGeometry(BLOCK.w - 0.1, BLOCK.d - 0.1)), labelMat(color, NAMES[type]));
  label.rotation.set(-Math.PI / 2, 0, Math.PI);
  label.position.y = BLOCK.h + 0.002;
  label.receiveShadow = true;
  root.add(label);

  const body = new THREE.Group(); // 出招、迈步作用在这一层
  body.position.y = BLOCK.h;
  const sway = new THREE.Group(); // 呼吸、摇晃作用在这一层
  body.add(sway);
  const figure = new THREE.Group(); // 真人偶
  figure.scale.setScalar(SCALE[type]);
  const parts = type === "B" ? bomb(a, figure) : type === "M" ? mine(a, figure) : type === "F" ? banner(a, figure, color) : trooper(a, figure, OFFICER[type]);
  const cloak = new THREE.Group(); // 蒙布造型
  tent(a, cloak);
  cloak.visible = false;
  // 背后的旗：所有兵种同一尺寸，蒙布时不泄露军衔
  const mast = new THREE.Group();
  mast.add(mesh(cyl(0.012, 0.012, MAST.h, 6), mat(WOOD), MAST.x, MAST.h / 2, MAST.z));
  const flag = makeFlag(color, GLYPH[type], MAST.fw, MAST.fh);
  flag.position.set(MAST.x, MAST.h - MAST.fh / 2 - 0.02, MAST.z);
  flag.rotation.y = -0.35;
  mast.add(flag, mesh(sph(0.022, 8), mat(a.trim, 0.3, 0.6), MAST.x, MAST.h + 0.01, MAST.z));
  // 军旗自己就是一面大旗，不蒙布时不再插小旗
  mast.visible = type !== "F";
  sway.add(figure, cloak, mast);

  root.add(body);
  root.rotation.y = color === "r" ? Math.PI : 0;
  root.userData = {
    code, color, type, body, sway, figure, cloak, mast, label, parts,
    mastFlag: flag,
    flag: parts.banner || flag, // idle/flagTo/flutter 操作的那面旗
    cloaked: false,
    baseYaw: root.rotation.y,
    phase: Math.random() * 10,
    wobble: new THREE.Vector2(),
    wobbleV: new THREE.Vector2(),
  };
  return root;
}

// 迷雾开关：hidden 时人偶换成军帐，旗和木块顶面都换成「？」
export function setCloaked(actor, hidden) {
  const u = actor.userData;
  if (u.cloaked === !!hidden) return;
  u.cloaked = !!hidden;
  u.figure.visible = !hidden;
  u.cloak.visible = !!hidden;
  u.label.material = labelMat(u.color, hidden ? "？" : NAMES[u.type]);
  const m = flagMats(u.color, hidden ? "？" : GLYPH[u.type]);
  const f = u.mastFlag.userData.flag;
  f.front.material = m.front;
  f.back.material = m.back;
  if (u.type === "F") {
    u.mast.visible = !!hidden;
    u.flag = hidden ? u.mastFlag : u.parts.banner;
  }
}

// 旗面顺风展开：风向垂直于镜头视线时，旗面正对镜头
export function flagTo(actor, dt, windYaw) {
  if (windYaw === null || windYaw === undefined) return;
  const fl = actor.userData.flag;
  let d = windYaw - actor.rotation.y - fl.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  fl.rotation.y += d * (1 - Math.exp(-dt * 2.5));
}

// 待机：呼吸、轻摇、旗帜飘动；被碰到时摇晃一下（弹簧）
export function idle(actor, t, dt, wind = 1, windYaw = null) {
  flagTo(actor, dt, windYaw);
  const u = actor.userData;
  // 地雷、军旗、炸弹是死物，不呼吸。蒙着布时照常呼吸：否则一眼就能从军帐里挑出它们
  const still = !u.cloaked && (u.type === "M" || u.type === "F" || u.type === "B");
  u.sway.scale.y = still ? 1 : 1 + Math.sin(t * 2.1 + u.phase) * 0.018;
  const k = 60, c = 6;
  u.wobbleV.x += (-k * u.wobble.x - c * u.wobbleV.x) * dt;
  u.wobbleV.y += (-k * u.wobble.y - c * u.wobbleV.y) * dt;
  u.wobble.x += u.wobbleV.x * dt;
  u.wobble.y += u.wobbleV.y * dt;
  u.sway.rotation.z = (still ? 0 : Math.sin(t * 1.3 + u.phase) * 0.025) + u.wobble.x;
  u.sway.rotation.x = u.wobble.y;
  if (u.parts.spark) u.parts.spark.scale.setScalar(0.7 + Math.abs(Math.sin(t * 17 + u.phase)) * 0.9);
  flutter(u.flag, t, wind);
}

export function flutter(flag, t, wind = 1) {
  const f = flag.userData.flag;
  const pos = f.geo.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < arr.length; i += 3) {
    const x = f.base[i];
    const y = f.base[i + 1];
    const k = x / f.w;
    arr[i + 2] = f.base[i + 2] + Math.sin(x * 14 - t * 7 * wind + f.phase + y * 3) * 0.035 * k * wind;
    arr[i + 1] = y - k * k * 0.02;
  }
  pos.needsUpdate = true;
  f.geo.computeVertexNormals();
}
