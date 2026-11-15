/**
 * [INPUT]: 无依赖。纯逻辑，不引用渲染库，也不产生随机数。
 * [OUTPUT]: 棋盘拓扑 CAMP/HQ/RAIL/STEP/EDGES/distance；棋子表 TYPES/COUNT/NAMES/GLYPH；
 *           布阵 parseLayout/mirrorLayout/layoutError/setupBoard/STANDARD/initialBoard；
 *           走法与战斗 pieceMoves/legalMoves/hasLegalMove/battle/apply/revert/pathOf；
 *           对局 createGame/play/undo/outcome；记谱 coord/notate；自检 perft/selfTest。
 * [POS]: engine 的唯一成员，全项目的裁判。它掌握全部真相；「谁能看见什么」不归它管，归 ai/knowledge。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// 军棋（陆战棋）规则引擎。
// 坐标：x 为列 0..4（红方视角从左到右），y 为行 0..11（红方底线 y = 0，黑方底线 y = 11）。
// 两个半场各 6 行，中间隔着「前线」：只有 0、2、4 三列有铁路相通，1、3 两列是山界，过不去。
// 棋子编码为两字符字符串：颜色 r/b + 兵种。兵种 9..1 就是军衔（司令 9 … 工兵 1），B 炸弹、M 地雷、F 军旗。

export const W = 5;
export const H = 12;
export const N = W * H;
export const HALF = H / 2;
export const RED = "r";
export const BLACK = "b";
export const other = (c) => (c === RED ? BLACK : RED);
export const sq = (x, y) => y * W + x;
export const fileOf = (s) => s % W;
export const rankOf = (s) => (s / W) | 0;
// 己方视角：行 0 = 底线，行 5 = 第一排（最靠前线）；列 0 = 自己的左手边
export const rowOf = (color, y) => (color === RED ? y : H - 1 - y);
export const ownSq = (color, col, row) => (color === RED ? sq(col, row) : sq(W - 1 - col, H - 1 - row));
export const homeOf = (s) => (s < N / 2 ? RED : BLACK);

// ---- 棋子 ---------------------------------------------------------------------------
export const TYPES = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "B", "M", "F"];
export const COUNT = { 9: 1, 8: 1, 7: 2, 6: 2, 5: 2, 4: 2, 3: 3, 2: 3, 1: 3, B: 2, M: 3, F: 1 };
export const NAMES = { 9: "司令", 8: "军长", 7: "师长", 6: "旅长", 5: "团长", 4: "营长", 3: "连长", 2: "排长", 1: "工兵", B: "炸弹", M: "地雷", F: "军旗" };
export const GLYPH = { 9: "司", 8: "军", 7: "师", 6: "旅", 5: "团", 4: "营", 3: "连", 2: "排", 1: "工", B: "炸", M: "雷", F: "旗" };
export const movable = (type) => type !== "M" && type !== "F";

// ---- 棋盘拓扑 -----------------------------------------------------------------------
export const CAMP = new Uint8Array(N); // 行营：里面的棋子不受攻击
export const HQ = new Uint8Array(N); // 大本营：进去就不能再动
export const RAIL = new Uint8Array(N); // 铁路上的站
export const STEP = Array.from({ length: N }, () => []); // 一步可达的全部邻站（公路 + 铁路）
export const EDGES = { all: 0, rail: 0 };
const ROAD = Array.from({ length: N }, () => []); // 只经公路相连的邻站
const NEXT = new Int8Array(N * 4).fill(-1); // 铁路上沿四个方向的下一站，没有则为 -1
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIST = new Int8Array(N * N).fill(-1);

{
  for (const color of [RED, BLACK]) {
    for (const [c, r] of [[1, 2], [3, 2], [2, 3], [1, 4], [3, 4]]) CAMP[ownSq(color, c, r)] = 1;
    for (const [c, r] of [[1, 0], [3, 0]]) HQ[ownSq(color, c, r)] = 1;
  }
  const link = (a, b, rail) => {
    STEP[a].push(b);
    STEP[b].push(a);
    EDGES.all++;
    if (!rail) {
      ROAD[a].push(b);
      ROAD[b].push(a);
      return;
    }
    EDGES.rail++;
    RAIL[a] = RAIL[b] = 1;
    const d = DIRS.findIndex(([dx, dy]) => fileOf(b) - fileOf(a) === dx && rankOf(b) - rankOf(a) === dy);
    NEXT[a * 4 + d] = b;
    NEXT[b * 4 + (d ^ 1)] = a;
  };
  const row = (y) => rowOf(homeOf(sq(0, y)), y);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // 横向铁路：每个半场的第二排（行 1）和第一排（行 5）
      if (x + 1 < W) link(sq(x, y), sq(x + 1, y), row(y) === 1 || row(y) === HALF - 1);
      if (y + 1 >= H) continue;
      // 跨前线：只有 0、2、4 三列通铁路。半场之内：两条边线从第二排到第一排是铁路，底线那一段是公路
      if (y === HALF - 1) {
        if (x % 2 === 0) link(sq(x, y), sq(x, y + 1), true);
      } else link(sq(x, y), sq(x, y + 1), (x === 0 || x === W - 1) && Math.min(row(y), row(y + 1)) >= 1);
    }
  // 行营八面通：补上四条斜线
  for (let s = 0; s < N; s++) {
    if (!CAMP[s]) continue;
    for (const dx of [-1, 1])
      for (const dy of [-1, 1]) {
        const t = sq(fileOf(s) + dx, rankOf(s) + dy);
        if (!STEP[s].includes(t)) link(s, t, false);
      }
  }
  // 两站之间最少要走几步（不看棋子，铁路也按一站一步算），评估距离用
  for (let a = 0; a < N; a++) {
    const queue = [a];
    DIST[a * N + a] = 0;
    for (let i = 0; i < queue.length; i++)
      for (const t of STEP[queue[i]])
        if (DIST[a * N + t] < 0) {
          DIST[a * N + t] = DIST[a * N + queue[i]] + 1;
          queue.push(t);
        }
  }
}
export const distance = (a, b) => DIST[a * N + b];

// ---- 布阵 ---------------------------------------------------------------------------
// layout：己方视角的 30 格，下标 = 行 × 5 + 列（行 0 是底线），行营处为 null。
// 红方的己方视角与棋盘坐标重合，所以 CAMP[i]、HQ[i] 可以直接用下标查。
export function parseLayout(rows) {
  const out = [];
  for (const row of rows) for (const ch of row.replace(/\s+/g, "")) out.push(ch === "." ? null : ch);
  return out;
}

export function mirrorLayout(layout) {
  return layout.map((_, i) => layout[rankOf(i) * W + (W - 1 - fileOf(i))]);
}

// 返回 null 表示合规，否则返回第一条违规原因
export function layoutError(layout) {
  if (!Array.isArray(layout) || layout.length !== N / 2) return "布阵必须正好 30 格";
  const left = { ...COUNT };
  for (let i = 0; i < layout.length; i++) {
    const t = layout[i];
    if (CAMP[i]) {
      if (t) return "开局时行营必须空着";
      continue;
    }
    if (!t || !(t in COUNT)) return "有空位或不认识的棋子";
    if (--left[t] < 0) return `${NAMES[t]}超编`;
    if (t === "F" && !HQ[i]) return "军旗必须放在大本营";
    if (t === "M" && rankOf(i) > 1) return "地雷只能放在后两排";
    if (t === "B" && rankOf(i) === HALF - 1) return "炸弹不能放在第一排";
  }
  return null;
}

// 自检和测试用的固定布阵（三颗雷围住军旗）：底线在上。它钉住 perft，不要改；对局用的阵型在 ai/formations。
export const STANDARD = parseLayout(["MFM22", "1M131", "5.B.4", "6B.37", "4.2.5", "73986"]);

export function setupBoard(red = STANDARD, black = STANDARD) {
  const board = new Array(N).fill(null);
  for (const [color, layout] of [[RED, red], [BLACK, black]]) {
    const err = layoutError(layout);
    if (err) throw new Error(`布阵不合规：${err}`);
    for (let i = 0; i < layout.length; i++) if (layout[i]) board[ownSq(color, fileOf(i), rankOf(i))] = color + layout[i];
  }
  return board;
}
export const initialBoard = () => setupBoard();

// ---- 战斗与走法 ----------------------------------------------------------------------
// 进攻方兵种 a 碰防守方兵种 d：win 吃掉对方，lose 自己阵亡，tie 同归于尽，flag 夺旗
export function battle(a, d) {
  if (d === "F") return "flag";
  if (a === "B" || d === "B") return "tie";
  if (d === "M") return a === "1" ? "win" : "lose";
  return a > d ? "win" : a < d ? "lose" : "tie";
}

const stamp = new Int32Array(N);
let tick = 0;
const queue = new Int8Array(N);

export function pieceMoves(board, s, out = []) {
  const p = board[s];
  const color = p[0];
  const type = p[1];
  if (!movable(type) || HQ[s]) return out;
  const reach = (t) => {
    const q = board[t];
    if (!q) out.push({ from: s, to: t, piece: p, target: null, result: "move" });
    else if (q[0] !== color && !CAMP[t]) out.push({ from: s, to: t, piece: p, target: q, result: battle(type, q[1]) });
    return !q;
  };
  if (RAIL[s] && type === "1") {
    // 工兵：沿铁路随意拐弯，只要一路都是空站
    stamp[s] = ++tick;
    queue[0] = s;
    for (let head = 0, tail = 1; head < tail; head++)
      for (let d = 0; d < 4; d++) {
        const t = NEXT[queue[head] * 4 + d];
        if (t < 0 || stamp[t] === tick) continue;
        stamp[t] = tick;
        if (reach(t)) queue[tail++] = t;
      }
  } else if (RAIL[s]) {
    // 其余棋子：沿铁路直行，不能拐弯，不能越子
    for (let d = 0; d < 4; d++) for (let t = NEXT[s * 4 + d]; t >= 0 && reach(t); t = NEXT[t * 4 + d]);
  }
  for (const t of ROAD[s]) reach(t);
  return out;
}

export function legalMoves(board, color, out = []) {
  for (let s = 0; s < N; s++) if (board[s] && board[s][0] === color) pieceMoves(board, s, out);
  return out;
}

const probe = [];
export function hasLegalMove(board, color) {
  for (let s = 0; s < N; s++) {
    if (!board[s] || board[s][0] !== color) continue;
    probe.length = 0;
    if (pieceMoves(board, s, probe).length) return true;
  }
  return false;
}

// 在棋盘上直接走/撤（搜索用，不维护历史）
export function apply(board, m) {
  board[m.from] = null;
  if (m.result !== "lose") board[m.to] = m.result === "tie" ? null : m.piece;
}
export function revert(board, m) {
  board[m.from] = m.piece;
  board[m.to] = m.target;
}

export function findFlag(board, color) {
  return board.indexOf(color + "F");
}

// 这一步实际经过的站：公路一步，或铁路上只穿过空站的最短路
export function pathOf(board, from, to) {
  if (STEP[from].includes(to)) return [from, to];
  const prev = new Int8Array(N).fill(-1);
  const line = [from];
  prev[from] = from;
  for (let i = 0; i < line.length; i++)
    for (let d = 0; d < 4; d++) {
      const t = NEXT[line[i] * 4 + d];
      if (t < 0 || prev[t] >= 0) continue;
      prev[t] = line[i];
      if (t === to) {
        const path = [];
        for (let c = to; c !== from; c = prev[c]) path.unshift(c);
        return [from, ...path];
      }
      if (!board[t]) line.push(t);
    }
  return null;
}
const turnsIn = (path) => path.some((s, i) => i >= 2 && s - path[i - 1] !== path[i - 1] - path[i - 2]);
const railEdge = (a, b) => NEXT[a * 4] === b || NEXT[a * 4 + 1] === b || NEXT[a * 4 + 2] === b || NEXT[a * 4 + 3] === b;

// ---- 有历史的对局 ----------------------------------------------------------------------
export const QUIET_LIMIT = 80; // 连续 80 步（半回合）没有交战判和
export const PLY_LIMIT = 500;
export const REPEAT_LIMIT = 3;

export function keyOf(board, side) {
  let s = side;
  for (let i = 0; i < N; i++) s += board[i] || "..";
  return s;
}

export function createGame(board = initialBoard(), side = RED) {
  const state = { board: board.slice(), side, history: [], quiet: 0, ply: 0, seen: new Map() };
  state.seen.set(keyOf(state.board, side), 1);
  return state;
}

// 走一步并返回记录。记录里除了走法，还有全场都看得见的事实：
// path 经过的站、rail 是否走铁路、turns 是否拐了弯（只有工兵做得到）、reveal 因司令阵亡而亮出的军旗。
export function play(state, move) {
  const { board } = state;
  const path = pathOf(board, move.from, move.to);
  const reveal = [];
  const fallen = (code) => {
    if (code[1] !== "9") return;
    const flag = findFlag(board, code[0]);
    if (flag >= 0) reveal.push({ color: code[0], sq: flag });
  };
  if (move.result === "lose" || move.result === "tie") fallen(move.piece);
  if (move.result === "win" || move.result === "tie") fallen(move.target);
  apply(board, move);
  const side = state.side;
  state.side = other(side);
  state.ply++;
  const quietBefore = state.quiet;
  state.quiet = move.target ? 0 : state.quiet + 1;
  const key = keyOf(board, state.side);
  state.seen.set(key, (state.seen.get(key) || 0) + 1);
  const entry = { ...move, side, path, rail: path.length > 2 || railEdge(move.from, move.to), turns: turnsIn(path), reveal, notation: notate(move), quietBefore, key };
  state.history.push(entry);
  return entry;
}

export function undo(state) {
  const e = state.history.pop();
  if (!e) return null;
  state.seen.set(e.key, state.seen.get(e.key) - 1);
  if (!state.seen.get(e.key)) state.seen.delete(e.key);
  revert(state.board, e);
  state.side = e.side;
  state.ply--;
  state.quiet = e.quietBefore;
  return e;
}

// 终局判定：军旗被夺、无棋可走判负；重复局面、长时间不交战、步数上限判和
export function outcome(state) {
  const { board, side } = state;
  for (const c of [RED, BLACK]) if (findFlag(board, c) < 0) return { over: true, winner: other(c), reason: "夺旗" };
  if (!hasLegalMove(board, side)) return { over: true, winner: other(side), reason: "无棋可走" };
  const last = state.history[state.history.length - 1];
  if (last && (state.seen.get(last.key) || 0) >= REPEAT_LIMIT) return { over: true, winner: null, reason: "三次重复局面" };
  if (state.quiet >= QUIET_LIMIT) return { over: true, winner: null, reason: `${QUIET_LIMIT} 步没有交战` };
  if (state.ply >= PLY_LIMIT) return { over: true, winner: null, reason: `达到 ${PLY_LIMIT} 步上限` };
  return { over: false };
}

// ---- 记谱 ---------------------------------------------------------------------------
// 军棋没有传统记谱法，这里用坐标：列 A..E（红方左手起），行 1..12（红方底线起）。
export const coord = (s) => "ABCDE"[fileOf(s)] + (rankOf(s) + 1);
export const VERDICT = { move: "", win: "胜", lose: "负", tie: "同归", flag: "夺旗" };

export function notate(m) {
  return `${NAMES[m.piece[1]]} ${coord(m.from)}${m.target ? "×" : "→"}${coord(m.to)}${m.target ? " " + VERDICT[m.result] : ""}`;
}

// ---- 自检 ---------------------------------------------------------------------------
export function perft(board, color, depth) {
  if (depth === 0) return 1;
  const list = legalMoves(board, color);
  if (depth === 1) return list.length;
  let n = 0;
  for (const m of list) {
    apply(board, m);
    n += perft(board, other(color), depth - 1);
    revert(board, m);
  }
  return n;
}

// 棋盘拓扑的六个定数 + 标准布阵合规 + 开局红方走法数。任何一项不对，说明规则被改坏了。
export const EXPECT = { camps: 10, hqs: 4, stations: 32, edges: 133, rails: 35, opening: 34 };
export function selfTest() {
  const sum = (a) => a.reduce((n, v) => n + v, 0);
  const got = {
    camps: sum(CAMP),
    hqs: sum(HQ),
    stations: sum(RAIL),
    edges: EDGES.all,
    rails: EDGES.rail,
    opening: layoutError(STANDARD) ? -1 : legalMoves(initialBoard(), RED).length,
  };
  const bad = Object.keys(EXPECT).filter((k) => got[k] !== EXPECT[k]);
  return { ok: bad.length === 0, got, expected: EXPECT, bad };
}
