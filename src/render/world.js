/**
 * [INPUT]: 依赖 three；依赖 engine/junqi 的拓扑表 CAMP/HQ/RAIL/STEP 与坐标函数 fileOf/rankOf。
 * [OUTPUT]: 尺寸常量 CELL_X/CELL_Z/FRONT_GAP/BOARD_W/BOARD_D/BOARD_T/TABLE/TRAY_X；
 *           坐标换算 toWorld/fromWorld/groundAt/traySlot；场景工厂 createWorld。
 * [POS]: render 的地基。它是「棋盘坐标 ↔ 世界坐标」的唯一出处，figures、director、sim 全部向它取尺寸。
 *        棋盘贴图直接读引擎的拓扑表来画，所以规则改了线路，贴图自动跟着变。它不碰对局状态。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { W, H, N, HALF, CAMP, HQ, RAIL, STEP, fileOf, rankOf } from "../engine/junqi.js";

export const CELL_X = 1.5; // 列距
export const CELL_Z = 1.0; // 行距
export const FRONT_GAP = 1.0; // 前线额外留的空：两个第一排相距 2
export const BOARD_W = 7.8; // x: -3.9 .. 3.9
export const BOARD_D = 13.6; // z: -6.8 .. 6.8
export const BOARD_T = 0.3; // 棋盘厚度：棋盘面 y = 0，桌面 y = -0.3
export const TABLE = { w: 17.4, d: 18, top: -BOARD_T, rimX: 8.3, rimZ: 8.6 };
export const TRAY_X = 6.1;
const TRAY = { w: 2.3, d: 7.2, cols: 3, dx: 0.68, dz: 0.82 };

// 棋盘坐标 → 世界坐标。红方在近处（+z），x 为列。
export const toWorld = (x, y) => new THREE.Vector3((x - 2) * CELL_X, 0, HALF - y * CELL_Z - (y >= HALF ? FRONT_GAP : 0));

// 世界坐标 → 最近的站 [x, y]；落在前线空带或界外返回 null
export function fromWorld(v) {
  const x = Math.round(v.x / CELL_X + 2);
  const y = v.z >= 0 ? Math.min(HALF - 1, Math.round(HALF - v.z)) : Math.max(HALF, Math.round(HALF - FRONT_GAP - v.z));
  if (x < 0 || x >= W || y < 0 || y >= H) return null;
  const p = toWorld(x, y);
  return Math.abs(v.x - p.x) <= CELL_X * 0.48 && Math.abs(v.z - p.z) <= CELL_Z * 0.5 ? [x, y] : null;
}

export function groundAt(x, z) {
  if (Math.abs(x) <= BOARD_W / 2 && Math.abs(z) <= BOARD_D / 2) return 0;
  return TABLE.top;
}

// ---- 棋盘贴图 -----------------------------------------------------------------------
const INK = "#4a2710";
const KAI = `"STKaiti","Kaiti SC","KaiTi","STSong","Songti SC",serif`;

function boardTexture() {
  const S = 100; // 每个世界单位的像素数
  const c = document.createElement("canvas");
  c.width = Math.round(BOARD_W * S);
  c.height = Math.round(BOARD_D * S);
  const g = c.getContext("2d");
  const px = (x) => (x + BOARD_W / 2) * S;
  const pz = (z) => (z + BOARD_D / 2) * S;
  const P = (s) => {
    const v = toWorld(fileOf(s), rankOf(s));
    return [px(v.x), pz(v.z)];
  };

  // 木纹底
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, "#dfb574");
  grad.addColorStop(1, "#cf9f5f");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 150; i++) {
    g.strokeStyle = `rgba(120,70,30,${0.03 + Math.random() * 0.05})`;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath();
    const x0 = Math.random() * c.width;
    g.moveTo(x0, 0);
    for (let y = 0; y <= c.height; y += 40) g.lineTo(x0 + Math.sin(y / 90 + i) * 6 + Math.random() * 2, y);
    g.stroke();
  }
  // 外框（双线）
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.strokeRect(px(-3.66), pz(-6.48), 7.32 * S, 12.96 * S);
  g.lineWidth = 2;
  g.strokeRect(px(-3.6), pz(-6.42), 7.2 * S, 12.84 * S);

  // 线路：先公路（细线），再铁路（粗的黑白相间线）。两端都在铁路上且相邻，就是铁路
  const roads = [], rails = [];
  for (let a = 0; a < N; a++) for (const b of STEP[a]) if (a < b) (RAIL[a] && RAIL[b] ? rails : roads).push([a, b]);
  const stroke = (list) => {
    g.beginPath();
    for (const [a, b] of list) {
      g.moveTo(...P(a));
      g.lineTo(...P(b));
    }
    g.stroke();
  };
  g.lineCap = "round";
  g.lineWidth = 3.5;
  stroke(roads);
  g.lineCap = "butt";
  g.lineWidth = 15;
  g.strokeStyle = "#2a1c12";
  stroke(rails);
  g.lineWidth = 8;
  g.strokeStyle = "#f6ecd6";
  g.setLineDash([13, 13]);
  stroke(rails);
  g.setLineDash([]);

  // 前线带：0、2、4 列挂「前线」牌，1、3 列是山界
  g.textAlign = "center";
  g.textBaseline = "middle";
  const plaque = (cx, cy, w, h, text, size) => {
    g.fillStyle = "#f2e2b8";
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.font = `bold ${size}px ${KAI}`;
    g.fillText(text, cx, cy + 2);
  };
  for (let x = 0; x < W; x++) {
    const cx = px((x - 2) * CELL_X), cy = pz(0);
    if (x % 2 === 0) {
      plaque(cx + (x === W - 1 ? -1 : 1) * 0.5 * S, cy, 0.62 * S, 0.34 * S, "前线", 0.22 * S);
      continue;
    }
    // 山：三座叠着的峰，带雪顶
    for (const [ox, w, h, tone] of [[-34, 46, 62, "#6f7d52"], [30, 44, 54, "#63714a"], [0, 60, 86, "#7f8d5e"]]) {
      const base = cy + 42;
      g.fillStyle = tone;
      g.strokeStyle = "#3d4a2c";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx + ox - w, base);
      g.lineTo(cx + ox, base - h);
      g.lineTo(cx + ox + w, base);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = "#f4efe2";
      g.beginPath();
      g.moveTo(cx + ox, base - h);
      g.lineTo(cx + ox - w * 0.26, base - h * 0.72);
      g.lineTo(cx + ox - w * 0.06, base - h * 0.78);
      g.lineTo(cx + ox + w * 0.1, base - h * 0.68);
      g.lineTo(cx + ox + w * 0.26, base - h * 0.72);
      g.closePath();
      g.fill();
    }
    plaque(cx, cy + 34, 0.6 * S, 0.3 * S, "山界", 0.2 * S);
  }

  // 站：兵站是圆角矩形，行营是圆圈，大本营是拱形。字朝向各自的主人
  for (let s = 0; s < N; s++) {
    const [cx, cy] = P(s);
    const red = s < N / 2;
    g.save();
    g.translate(cx, cy);
    if (!red) g.rotate(Math.PI);
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    g.beginPath();
    if (CAMP[s]) {
      g.fillStyle = "#dfe3b4";
      g.arc(0, 0, 0.37 * S, 0, Math.PI * 2);
    } else if (HQ[s]) {
      g.fillStyle = red ? "#f3cfa6" : "#cfd6dc";
      const w = 0.54 * S, h = 0.31 * S;
      g.moveTo(-w, h);
      g.lineTo(-w, -h * 0.2);
      g.bezierCurveTo(-w, -h * 1.5, w, -h * 1.5, w, -h * 0.2);
      g.lineTo(w, h);
      g.closePath();
    } else {
      g.fillStyle = "#f3e5bf";
      g.roundRect(-0.53 * S, -0.3 * S, 1.06 * S, 0.6 * S, 0.1 * S);
    }
    g.fill();
    g.stroke();
    g.fillStyle = CAMP[s] ? "#55602f" : red ? "#9a2a1c" : "#27333f";
    if (CAMP[s]) {
      g.font = `bold ${0.21 * S}px ${KAI}`;
      g.fillText("行营", 0, 2);
    } else if (HQ[s]) {
      g.font = `bold ${0.2 * S}px ${KAI}`;
      g.fillText("大本营", 0, 6);
    }
    g.restore();
  }

  // 边缘的坐标：列 A–E，行 1–12
  g.fillStyle = "rgba(74,39,16,0.62)";
  g.font = `bold ${0.15 * S}px ui-monospace,Menlo,monospace`;
  const label = (text, cx, cy, flip) => {
    g.save();
    g.translate(cx, cy);
    if (flip) g.rotate(Math.PI);
    g.fillText(text, 0, 0);
    g.restore();
  };
  for (let x = 0; x < W; x++) {
    label("ABCDE"[x], px((x - 2) * CELL_X), pz(6.64), false);
    label("ABCDE"[x], px((x - 2) * CELL_X), pz(-6.64), true);
  }
  for (let y = 0; y < H; y++) {
    const z = toWorld(0, y).z;
    label(String(y + 1), px(-3.78), pz(z), y >= HALF);
    label(String(y + 1), px(3.78), pz(z), y >= HALF);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function lacquer(color, rough = 0.32) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1714");
  scene.fog = new THREE.Fog("#1b1714", 34, 68);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 15, 17);
  camera.lookAt(0, 0, 0);

  // 灯光：暖色主光带阴影，冷色补光，天光
  scene.add(new THREE.HemisphereLight("#fff4e0", "#3a2a20", 0.85));
  const key = new THREE.DirectionalLight("#ffe2b8", 2.4);
  key.position.set(-7, 17, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -12;
  sc.right = 12;
  sc.top = 12.5;
  sc.bottom = -12.5;
  sc.near = 1;
  sc.far = 50;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#9fc4ff", 0.45);
  fill.position.set(9, 7, -8);
  scene.add(fill);

  // 地面（榻榻米色），桌子
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: "#3b3127", roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.2;
  floor.receiveShadow = true;
  scene.add(floor);

  const table = new THREE.Group();
  const edgeMat = lacquer("#2a0d08", 0.35);
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 0.4, TABLE.d), lacquer("#5a1d14", 0.28));
  top.position.y = TABLE.top - 0.2;
  top.receiveShadow = true;
  top.castShadow = true;
  table.add(top);
  // 桌沿凸起的边
  const rimH = 0.12;
  for (const [w, d, x, z] of [
    [TABLE.w, 0.18, 0, TABLE.d / 2 - 0.09],
    [TABLE.w, 0.18, 0, -TABLE.d / 2 + 0.09],
    [0.18, TABLE.d, TABLE.w / 2 - 0.09, 0],
    [0.18, TABLE.d, -TABLE.w / 2 + 0.09, 0],
  ]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), edgeMat);
    rim.position.set(x, TABLE.top + rimH / 2, z);
    rim.castShadow = rim.receiveShadow = true;
    table.add(rim);
  }
  // 束腰与短腿
  const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w - 1, 0.5, TABLE.d - 1), edgeMat);
  apron.position.y = TABLE.top - 0.65;
  table.add(apron);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), edgeMat);
      leg.position.set(sx * (TABLE.w / 2 - 0.9), TABLE.top - 1.3, sz * (TABLE.d / 2 - 0.9));
      leg.castShadow = true;
      table.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), lacquer("#c9a24a", 0.4));
      foot.position.set(sx * (TABLE.w / 2 - 0.9), -2.14, sz * (TABLE.d / 2 - 0.9));
      table.add(foot);
    }
  scene.add(table);

  // 棋盘：木块，顶面贴棋盘纹
  const boardTop = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.62 });
  const boardSide = new THREE.MeshStandardMaterial({ color: "#b98446", roughness: 0.55 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_T, BOARD_D), [boardSide, boardSide, boardTop, boardSide, boardSide, boardSide]);
  board.position.y = -BOARD_T / 2;
  board.receiveShadow = true;
  board.castShadow = true;
  scene.add(board);

  // 两侧托盘：左边收红方阵亡的子，右边收黑方阵亡的子
  const trays = {};
  for (const [color, x] of [["r", -TRAY_X], ["b", TRAY_X]]) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(TRAY.w, 0.08, TRAY.d), lacquer(color === "r" ? "#6d2418" : "#1e262f", 0.4));
    base.position.y = TABLE.top + 0.04;
    base.receiveShadow = true;
    g.add(base);
    const wallMat = lacquer("#c9a24a", 0.35);
    const hw = TRAY.w / 2 - 0.04, hd = TRAY.d / 2 - 0.04;
    for (const [w, d, ox, oz] of [[TRAY.w, 0.08, 0, hd], [TRAY.w, 0.08, 0, -hd], [0.08, TRAY.d, hw, 0], [0.08, TRAY.d, -hw, 0]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), wallMat);
      wall.position.set(ox, TABLE.top + 0.15, oz);
      wall.castShadow = true;
      g.add(wall);
    }
    g.position.x = x;
    scene.add(g);
    trays[color] = { group: g, x, count: 0 };
  }

  // 选子用的透明平面
  const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_D), new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.rotation.x = -Math.PI / 2;
  pickPlane.position.y = 0.01;
  scene.add(pickPlane);

  return { renderer, scene, camera, trays, pickPlane, key };
}

// 托盘里的第 i 个位置：3 列 × 8 行，缩小摆放，一方 24 个阵亡的子正好装满
export function traySlot(tray, i) {
  const col = i % TRAY.cols;
  const row = Math.floor(i / TRAY.cols) % 8;
  return new THREE.Vector3(tray.x + (col - 1) * TRAY.dx, TABLE.top + 0.08, -3.5 * TRAY.dz + row * TRAY.dz);
}
