/**
 * [INPUT]: 依赖 engine/junqi 的 selfTest、legalMoves、sq、N、HQ、TYPES、COUNT、GLYPH；依赖 game/match 的 createMatch、decide、commit、startTurn、branch、visible、LEVELS；
 *          依赖 ai/formations 的 FORMATIONS（阵型清单）；依赖 ui/seating 的 createSeating（开局牌）；
 *          依赖 ai/rng 的 makeRng、freshSeed；依赖 render/world 的 createWorld、toWorld、fromWorld；依赖 sim/show 的 Stage；依赖 render/director 的 Director
 * [OUTPUT]: 无导出。页面入口；在 window.__jq 上留一个调试把手
 * [POS]: 总控。回合流程：引擎裁决 → 电脑选择 → 演出 → 导播。各层只通过走法记录交流。
 *        它还决定「观众是谁」（全知 / 红方 / 黑方），据此挑文字、挑胜率、给棋子蒙布——暗棋的保密在这里落到画面上。
 *        入座流程也在这里：演示 → 点兵 → 对局，三种状态写在 body 的 data-mode 上，样式据此显隐各个零件。
 *        选子时给出大本营警示：走进大本营就再也出不来，困在里面的子也当场说明缘由。
 *        适配屏幕也在这里：视野随宽高比变、旗面随镜头俯角后仰、轻点才算落子。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { selfTest, legalMoves, sq, N, HQ, TYPES, COUNT, GLYPH } from "./engine/junqi.js";
import { createMatch, decide, commit, startTurn, branch, visible, DEFAULTS, LEVELS } from "./game/match.js";
import { FORMATIONS } from "./ai/formations.js";
import { createSeating } from "./ui/seating.js";
import { makeRng, freshSeed } from "./ai/rng.js";
import { createWorld, toWorld, fromWorld } from "./render/world.js";
import { Stage } from "./sim/show.js";
import { Director } from "./render/director.js";

const $ = (id) => document.getElementById(id);
const SIDE = { r: "红", b: "黑" };

// ---- 自检 ---------------------------------------------------------------------------
const test = selfTest();
if (test.ok) console.info("[军棋自检] 通过：", JSON.stringify(test.got));
else {
  console.error(`[军棋自检] 失败：${test.bad.join("、")} 不对`, test.got, "应为", test.expected);
  $("selftest").className = "badge fail";
  $("selftest").textContent = `自检失败 ${test.bad.join(" ")}`;
}

// ---- 场景 ---------------------------------------------------------------------------
const canvas = $("scene");
const { renderer, scene, camera, trays, pickPlane } = createWorld(canvas);
const stage = new Stage(scene, camera, trays, makeRng("init"));
const director = new Director(camera, canvas);
director.obstacles = () => [...stage.actors.values()];
// 系统要求减少动态效果时：点兵的走位和固定机位的滑动都直接到位（对局里的走子演出是棋的内容，不在此列）
stage.calm = director.calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// 竖屏时把垂直视野撑大，让水平视野不小于 6:5 画面时的宽度；否则手机上只剩一条窄缝，全是特写
const FOV = { base: 38, aspect: 1.2, max: 78 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const half = Math.tan(THREE.MathUtils.degToRad(FOV.base / 2));
  camera.fov = camera.aspect >= FOV.aspect ? FOV.base : Math.min(FOV.max, THREE.MathUtils.radToDeg(2 * Math.atan((half * FOV.aspect) / camera.aspect)));
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---- 状态 ---------------------------------------------------------------------------
const settings = { ...DEFAULTS };
const control = { r: "ai", b: "ai" };
let view = "all"; // 观众：all 全知 | r | b
let match = null;
let seed = freshSeed();
let paused = false;
let speed = 1;
let mode = "demo"; // 桌上在做什么：demo 电脑自己下给人看 | muster 人已入座、正在点兵 | play 人在下
let phase = "gap"; // 一步棋走到哪：gap | think | ready | human | show | over；点兵时是 muster，谁都不走
let gap = 1.2;
let thinker = null;
let thinkStart = 0;
let overTimer = 0;
let ready = null;
const camDir = new THREE.Vector3();
let windYaw = 0;

// 终局后一切亮开，所以观众一律按全知算
const viewer = () => (match.result.over ? "all" : view);

// reform：点兵时换阵型，棋子还是原来那些，只让己方走到新位置，不整盘重摆
function newGame(s, script = null, reform = false) {
  seed = s;
  match = createMatch(seed, { ...settings }, script);
  if (script) showSettings(match.settings);
  if (reform) stage.muster(match.state.board, settings.seat.side);
  else stage.reset(match.state.board, makeRng(seed).fork("show"));
  $("seed").textContent = seed;
  intro(script);
  $("banner").classList.add("hidden");
  thinker = null;
  ready = null;
  clearMarks();
  phase = mode === "muster" ? "muster" : "gap";
  gap = 1.4;
  refresh();
}

// ---- 界面 ---------------------------------------------------------------------------
function setWin(p) {
  $("win-fill").style.transform = `scaleX(${p.toFixed(3)})`;
  $("win-red").textContent = `红 ${Math.round(p * 100)}%`;
  $("win-black").textContent = `黑 ${Math.round((1 - p) * 100)}%`;
}
function say(text, sub = "") {
  $("comment-text").textContent = text;
  $("comment-sub").textContent = sub;
  const el = $("comment");
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  setTimeout(() => el.classList.remove("pop"), 300);
}
function status(text) {
  $("status").textContent = text;
}
function addMove(rec, ply) {
  const list = $("moves");
  const n = Math.ceil(ply / 2);
  let li = list.querySelector(`li[data-n="${n}"]`);
  if (!li) {
    li = document.createElement("li");
    li.dataset.n = n;
    li.innerHTML = `<span class="n">${n}.</span><span class="r"></span><span class="b"></span>`;
    list.appendChild(li);
  }
  const cell = li.querySelector(rec.side === "r" ? ".r" : ".b");
  cell.textContent = rec.text[viewer()].notation;
  cell.title = rec.text[viewer()].comment;
  if (rec.target) cell.classList.add("cap");
  list.querySelectorAll("li.latest").forEach((x) => x.classList.remove("latest"));
  li.classList.add("latest");
  list.scrollTop = list.scrollHeight;
}

// 一方的简介。对手的性格和阵型也要保密：每种性格只配两套阵型，报出性格就等于报出了雷和旗的摆法
function armyLabel(color) {
  const v = viewer(), a = match.armies[color];
  // 人坐的那一方没有「性格」可言：只报他自己点的阵
  if (mode !== "demo" && settings.seat?.side === color) return `你 · ${a.formation.name}`;
  return v === "all" || v === color ? `${a.persona.name} · ${a.formation.name}` : "对手保密";
}

// 开局白：报种子和双方来历。按当前观众说话，所以还没走棋时换了视角要重说一遍，免得上一句把对手的阵型留在屏幕上
function intro(script = null) {
  say(script ? `重放种子 ${seed}` : `新的一局，种子 ${seed}`, script && script.events.length ? `按原局的 ${script.events.length} 处设置改动和你的走法精确重放` : `红方 ${armyLabel("r")}，黑方 ${armyLabel("b")} · ${match.settings.mode === "open" ? "明棋" : "暗棋"}`);
}

// 兵力表：十二个兵种一列一个，红黑两行上下对照。满编、有损、打光三种状态靠明暗区分；
// 认不出的敌子不占兵种格，只在行尾报个数。
$("roster-head").innerHTML = "<b></b>" + TYPES.map((t) => `<span>${GLYPH[t]}</span>`).join("");
function roster(color) {
  const alive = {};
  let fog = 0;
  for (let s = 0; s < N; s++) {
    const p = match.state.board[s];
    if (!p || p[0] !== color) continue;
    if (visible(match, viewer(), s)) alive[p[1]] = (alive[p[1]] || 0) + 1;
    else fog++;
  }
  const cell = (t) => {
    const n = alive[t] || 0;
    if (fog && !n) return `<span class="unknown">·</span>`;
    return `<span class="${n === 0 ? "gone" : n < COUNT[t] && !fog ? "hurt" : ""}">${n}</span>`;
  };
  $("roster-" + color).innerHTML = `<b>${SIDE[color]}</b>${TYPES.map(cell).join("")}${fog ? `<em>另有暗子 ${fog} 个</em>` : ""}`;
}

// 观众或局面变了：蒙布、棋谱、兵力表、胜率、双方简介全部按当前观众重画
function refresh() {
  const v = viewer();
  // 演出途中不动蒙布：这时棋盘已是走完后的样子，而将要阵亡的棋子还站在台上，按格子判断会揭错人。演完会再刷一次
  if (phase !== "show") stage.applyCloaks((s) => !visible(match, v, s));
  $("moves").innerHTML = "";
  match.log.forEach((rec, i) => addMove(rec, i + 1));
  roster("r");
  roster("b");
  const last = match.log[match.log.length - 1];
  setWin(last ? last.win[v] : 0.5);
  for (const c of ["r", "b"]) $("army-" + c).textContent = armyLabel(c);
}

$("btn-new").onclick = () => newGame(freshSeed());
$("btn-replay").onclick = () => mode !== "muster" && newGame(seed, match.script);

// ---- 入座点兵 ------------------------------------------------------------------------
// 演示 →（我来下一盘）→ 点兵：选执子、阵型、对手 →（开局）→ 对局 →（再来一盘 / 观战 / 离座）
function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
}
function setControl(human) {
  for (const c of ["r", "b"]) {
    control[c] = c === human ? "human" : "ai";
    $("ctl-" + c).value = control[c];
  }
}
const levelOf = (key) => LEVELS.find((l) => l.key === key);
const seating = createSeating($("seat"), {
  formations: Object.entries(FORMATIONS).map(([name, f]) => ({ name, note: f.note })),
  levels: LEVELS,
  // 换阵型或镜像：己方走位；换执子方：整盘重摆；换对手：棋盘不变，开局时才生效
  onChange: (what) => what !== "level" && muster(what === "side" ? "reset" : "reform"),
  onStart: startPlay,
  onCancel: leave,
});

// how：reseed 换一盘新的 | reset 同一盘整盘重摆 | reform 同一盘只让己方走位
function muster(how) {
  const { side, formation, mirror } = seating.seat;
  setMode("muster");
  setPaused(false);
  setControl(null);
  settings.seat = { side, formation, mirror };
  view = side; // 先定观众再开局：对手从第一眼起就蒙着布
  $("view").value = side;
  newGame(how === "reseed" ? freshSeed() : seed, null, how === "reform");
  director.muster = true;
  director.setMode("seat", side);
  requestAnimationFrame(fitMuster);
}
// 开局牌盖住了屏幕下方多少：竖屏点兵时，导播据此把己方半场让到牌的上沿之上
function fitMuster() {
  // offsetTop 是排版位置，不受进场动画的位移影响
  if (mode === "muster") director.cover = 1 - $("seat").offsetTop / window.innerHeight;
}
window.addEventListener("resize", fitMuster);

function startPlay() {
  const { side, level } = seating.seat;
  const lv = levelOf(level);
  showSettings({ ...settings, temperature: lv.temperature, depth: lv.depth });
  setMode("play");
  setControl(side);
  newGame(seed, null, true); // 同一盘、同一阵，带上选定的难度正式开局；棋子已经在位
  $("seat-info").textContent = `你执${SIDE[side]} · 对手${lv.name}`;
  director.muster = false;
  director.setMode("seat", side);
}

function leave() {
  setMode("demo");
  setControl(null);
  showSettings({ ...settings, temperature: DEFAULTS.temperature, depth: DEFAULTS.depth, seat: null });
  setView("all");
  director.muster = false;
  director.setMode("auto");
  newGame(freshSeed());
}
$("btn-sit").onclick = $("btn-again").onclick = () => {
  seating.sync();
  muster("reseed");
};
$("btn-watch").onclick = $("btn-leave").onclick = leave;

// 界面显示某组设置（重放时跟随原局）
function showSettings(st) {
  Object.assign(settings, st);
  $("temp").value = String(st.temperature);
  $("temp-out").textContent = st.temperature.toFixed(2);
  $("depth").value = String(st.depth);
  $("mode").value = st.mode;
}
// 重放途中用户自己改了东西：从这里起按新的来
function userChanged() {
  if (match?.replay) {
    branch(match);
    status("已偏离重放，从这里起按你的设置继续");
  }
}
$("btn-pause").onclick = () => setPaused(!paused);
function setFolded(folded) {
  $("controls").classList.toggle("folded", folded);
  $("btn-fold").textContent = folded ? "设置" : "收起";
}
$("btn-fold").onclick = () => setFolded(!$("controls").classList.contains("folded"));
// 设置默认收起，把画面让给棋盘：来的多半是下棋的人，种子、温度、深度是行家才动的东西。
// 窄屏上棋谱和兵力表做成「战况」抽屉，和设置面板不同时展开
setFolded(true);
$("btn-record").onclick = () => {
  if ($("record").classList.toggle("open")) setFolded(true);
};
$("btn-fold").addEventListener("click", () => $("record").classList.remove("open"));
function setPaused(p) {
  paused = p;
  $("btn-pause").textContent = paused ? "继续" : "暂停";
  $("btn-pause").setAttribute("aria-pressed", String(paused));
  status(paused ? "已暂停" : "");
}
$("speed").oninput = (e) => {
  speed = Number(e.target.value);
  $("speed-out").textContent = `${speed.toFixed(1)}×`;
};
$("temp").oninput = (e) => {
  settings.temperature = Number(e.target.value);
  $("temp-out").textContent = settings.temperature.toFixed(2);
  userChanged(); // 新设置从下一回合开始生效，并记进对局脚本
};
$("depth").onchange = (e) => {
  settings.depth = Number(e.target.value);
  userChanged();
};
// 明棋 / 暗棋一盘之内不能变：同一种子、同一布阵，换个规则重新开
$("mode").onchange = (e) => {
  settings.mode = e.target.value;
  newGame(seed, null, mode === "muster");
};
function setView(v) {
  view = v;
  $("view").value = v;
  if (!match) return;
  refresh();
  if (!match.log.length) intro();
}
$("view").onchange = (e) => setView(e.target.value);
// 入座：坐到当前视角那一方的身后；全知观战时默认坐红方
$("camera").onchange = (e) => director.setMode(e.target.value, view === "b" ? "b" : "r");
director.onUserTakeover = (mode) => ($("camera").value = mode);
for (const c of ["r", "b"]) {
  $("ctl-" + c).onchange = (e) => {
    control[c] = e.target.value;
    userChanged();
    // 只接管一方时坐到那一方的位置上；两边都交给电脑（或都自己下）就回到全知观战
    const humans = ["r", "b"].filter((x) => control[x] === "human");
    setView(humans.length === 1 ? humans[0] : "all");
    // 镜头跟着换：亲手下棋时固定在己方身后，全交给电脑时回到自动导播
    if (humans.length === 1) director.setMode("seat", humans[0]);
    else if (director.mode === "seat") director.setMode("auto");
    // 接管：如果这一方正在思考或等待，重新开始这一回合
    if (match && match.state.side === c && (phase === "think" || phase === "ready" || phase === "human")) {
      thinker = null;
      ready = null;
      clearMarks();
      phase = "gap";
      gap = 0.2;
    }
  };
}
window.addEventListener("keydown", (e) => {
  // 空格暂停。焦点在控件上时空格是在按那个控件；点兵时棋局还没开始，没有可暂停的东西
  if (e.key === " " && mode !== "muster" && !["INPUT", "SELECT", "BUTTON", "SUMMARY"].includes(e.target.tagName)) {
    e.preventDefault();
    setPaused(!paused);
  }
});
stage.on((ev) => {
  if (ev.type === "blast") director.shake(ev.power);
});

// ---- 人类走子 ------------------------------------------------------------------------
const marks = new THREE.Group();
scene.add(marks);
let selected = -1;
function clearMarks() {
  marks.clear();
  selected = -1;
}
function markAt(s, color, r = 0.48) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.07, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(toWorld(s % 5, (s / 5) | 0)).setY(0.02);
  marks.add(m);
}
const ray = new THREE.Raycaster();
// 轻点才算落子：按下和抬起几乎在同一处。拖动是在转镜头（触屏上尤其如此），不能误选棋子
let press = null;
canvas.addEventListener("pointerdown", (e) => {
  press = e.button === 0 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
});
canvas.addEventListener("pointerup", (e) => {
  const tap = press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10 && performance.now() - press.at < 600;
  press = null;
  if (!tap || phase !== "human" || paused) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(pickPlane)[0];
  const cell = hit && fromWorld(hit.point);
  if (!cell) return;
  const s = sq(cell[0], cell[1]);
  const side = match.state.side;
  const legal = legalMoves(match.state.board, side);
  const p = match.state.board[s];
  if (p && p[0] === side) {
    clearMarks();
    selected = s;
    markAt(s, "#e9c46a", 0.6);
    let hqTo = false;
    for (const m of legal)
      if (m.from === s) {
        // 大本营单独用琥珀色圈：进去就再也出不来，得让玩家看清这是个单程门
        markAt(m.to, m.target ? "#ff6b5a" : HQ[m.to] ? "#e8a13a" : "#7dd87d", m.target ? 0.6 : 0.3);
        if (HQ[m.to]) hqTo = true;
      }
    if (HQ[s]) status("这枚棋子在大本营里，按规则从此不能再移动");
    else if (hqTo) status("注意：走进大本营的棋子从此不能再移动，进去前想清楚");
    return;
  }
  if (selected >= 0) {
    const m = legal.find((mm) => mm.from === selected && mm.to === s);
    if (m) {
      clearMarks();
      play({ move: m, kind: "human" });
    }
  }
});

// ---- 回合流程 -----------------------------------------------------------------------
function beginTurn() {
  if (match.result.over) return finish();
  const side = match.state.side;
  const replaying = !!match.replay;
  const { scripted } = startTurn(match, { ...settings });
  if (replaying) showSettings(match.settings);
  if (scripted) {
    // 重放原局里人类下的那一步
    status("重放：当时你下的这一步");
    ready = { choice: scripted, at: performance.now() + 700 / speed };
    phase = "ready";
    return;
  }
  if (replaying && !match.replay) status("重放结束，接着按当前设置下");
  // 重放进行中：原局由电脑下的步照样交给电脑，保证逐步一致
  if (control[side] === "human" && !match.replay) {
    phase = "human";
    status(`轮到你走${SIDE[side]}方：点己方棋子，再点目标点`);
    return;
  }
  phase = "think";
  thinker = decide(match);
  thinkStart = performance.now();
  status(`${SIDE[side]}方推演中…`);
}

function stepThinker(budget) {
  const t0 = performance.now();
  while (performance.now() - t0 < budget) {
    const r = thinker.next();
    if (r.done) {
      thinker = null;
      return r.value;
    }
  }
  return undefined;
}

function play(choice) {
  const rec = commit(match, choice);
  const v = viewer();
  addMove(rec, match.log.length);
  say(rec.text[v].comment, rec.replayed ? "重放你当时的走法" : rec.kind === "blunder" ? "高温下的随机失误" : rec.kind === "soft" ? "温度让它选了次优的一步" : "");
  setWin(rec.win[v]);
  status("");
  phase = "show";
  // 军旗告急的特写只给认得出那面旗的观众看，否则镜头本身就泄密了
  const alarm = rec.alarm >= 0 && visible(match, v, rec.alarm) ? rec.alarm : undefined;
  stage.perform(rec, { alarm }).then(() => {
    phase = "gap";
    gap = 0.55;
    refresh(); // 这一步可能让观众认出了新的敌子（例如工兵拐弯、司令阵亡亮旗）
    if (match.result.over) finish();
  });
}

function finish() {
  phase = "over";
  const r = match.result;
  const me = mode === "play" ? settings.seat.side : null; // 人在下时，胜负从他的座位上说
  const title = !r.winner ? "和棋" : me ? (r.winner === me ? "你赢了" : "你输了") : `${SIDE[r.winner]}方胜`;
  $("banner-title").textContent = title;
  $("banner-sub").textContent = `${r.reason} · 共 ${match.log.length} 步 · 种子 ${seed}`;
  $("banner").classList.remove("hidden");
  say(`${title}：${r.reason}`, "终局，双方棋子全部亮开");
  status(!me && $("auto-next").checked ? "稍后自动开始新的一局" : "对局结束");
  refresh();
  const last = match.log[match.log.length - 1];
  const at = last ? last.to : sq(2, 5);
  stage.focus = { kind: "over", at: toWorld(at % 5, (at / 5) | 0) };
  overTimer = 9;
}

// ---- 主循环 -------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sdt = paused ? 0 : dt * speed;
  if (!paused && match) {
    if (phase === "gap") {
      gap -= sdt;
      if (gap <= 0) beginTurn();
    } else if (phase === "think" && thinker) {
      const choice = stepThinker(8);
      if (choice !== undefined) {
        if (!choice) finish();
        else {
          // 至少「想」一小会儿，看起来更像在下棋
          ready = { choice, at: thinkStart + 450 / speed };
          phase = "ready";
        }
      }
    } else if (phase === "ready" && ready && now >= ready.at) {
      const c = ready.choice;
      ready = null;
      play(c);
    } else if (phase === "over" && mode === "demo" && $("auto-next").checked) {
      overTimer -= sdt;
      if (overTimer <= 0) newGame(freshSeed());
    }
  }
  // 风向：垂直于镜头的水平视线，选和上一帧接近的那一侧，缓慢变化
  camera.getWorldDirection(camDir);
  const wa = Math.atan2(camDir.x, camDir.z); // 旗面 +X 轴转到这个朝向时与视线垂直，旗面正对镜头
  const wb = wa + Math.PI;
  const near = (a) => Math.abs(Math.atan2(Math.sin(a - windYaw), Math.cos(a - windYaw)));
  windYaw = near(wa) <= near(wb) ? wa : wb;
  stage.windYaw = windYaw;
  // 镜头俯角超过约 50° 时（俯视、竖屏入座），旗面逐渐后仰到正对镜头；仰向哪一边取决于旗面此刻哪一面朝着镜头
  const pitch = Math.asin(Math.min(1, Math.max(-1, -camDir.y)));
  stage.flagTilt = (windYaw === wa ? 1 : -1) * pitch * THREE.MathUtils.smoothstep(pitch, 0.8, 1.15);
  stage.update(sdt, dt);
  director.update(dt, stage.focus, !paused);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

newGame(seed);
requestAnimationFrame(frame);

// 调试入口（不影响对局）
window.__jq = {
  get match() { return match; },
  get phase() { return phase; },
  get view() { return view; },
  newGame,
  setPaused,
  setView,
  stage,
  director,
  // 棋盘点在画面上的位置（0..1），给自动化测试点击用
  screenOf(x, y) {
    const v = toWorld(x, y).project(camera);
    return [(v.x + 1) / 2, (1 - v.y) / 2];
  },
  get drawn() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fov: Math.round(camera.fov) }; },
  fps() {
    return new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(f)) : res(Math.round(n / 2)));
      requestAnimationFrame(f);
    });
  },
};
