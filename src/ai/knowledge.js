/**
 * [INPUT]: 依赖 engine/junqi 的棋子表（TYPES/COUNT）、布阵约束所需的拓扑（HQ/rowOf）和战斗规则 battle
 * [OUTPUT]: createKnowledge、learn、observe、sampleWorld、identified、single、typeOf
 * [POS]: ai 的暗棋边界。引擎知道全部真相，这里只保留「一方凭公开事实能推出的东西」。
 *        brain 只吃 observe() 给的视图，所以电脑从结构上就偷看不到对方的兵种；明棋只是「信念一开始就全部确定」的特例。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { N, RED, TYPES, COUNT, HQ, HALF, rowOf, rankOf, other, movable, battle } from "../engine/junqi.js";

// 信念用位掩码表示：第 i 位为 1 = 这个棋子还可能是 TYPES[i]
const BIT = Object.fromEntries(TYPES.map((t, i) => [t, 1 << i]));
const ALL = (1 << TYPES.length) - 1;
const MOBILE = TYPES.reduce((m, t) => (movable(t) ? m | BIT[t] : m), 0);
const SLOTS = TYPES.flatMap((t) => new Array(COUNT[t]).fill(t)); // 一方的 25 个编制名额
const ARMY = SLOTS.length;

export const single = (mask) => mask !== 0 && (mask & (mask - 1)) === 0;
export const typeOf = (mask) => TYPES[31 - Math.clz32(mask)];

// 从战斗规则反推，不另写一份大小表：
// attackers：哪些兵种进攻我方的 mine 会打出 result；defenders：我方的 mine 进攻哪些兵种会打出 result
const attackers = (mine, result) => TYPES.reduce((m, t) => (movable(t) && battle(t, mine) === result ? m | BIT[t] : m), 0);
const defenders = (mine, result) => TYPES.reduce((m, t) => (battle(mine, t) === result ? m | BIT[t] : m), 0);

// viewer 对敌方每个棋子的信念。只读对方棋子的「位置」，兵种靠布阵规则圈定范围。
// open = 明棋：直接记下真实兵种。
export function createKnowledge(viewer, board, open = false) {
  const enemy = other(viewer);
  const masks = new Uint16Array(N); // 按格子存；棋子走到哪，信念跟到哪
  for (let s = 0; s < N; s++) {
    const p = board[s];
    if (!p || p[0] !== enemy) continue;
    if (open) {
      masks[s] = BIT[p[1]];
      continue;
    }
    const row = rowOf(enemy, rankOf(s));
    let m = ALL;
    if (!HQ[s]) m &= ~BIT.F; // 军旗只在大本营
    if (row > 1) m &= ~BIT.M; // 地雷只在后两排
    if (row === HALF - 1) m &= ~BIT.B; // 炸弹不在第一排
    masks[s] = m;
  }
  const k = { viewer, enemy, masks, dead: [] }; // dead：已阵亡敌子的信念，抽样时照样占编制
  settle(k);
  return k;
}

// 数编制：某兵种的名额已被认定的棋子占满 → 其余棋子不可能是它；
// 还可能是它的棋子刚好填满名额 → 它们全都是它（要求敌方 25 子都在账上）。
function settle(k) {
  const { masks, dead } = k;
  const total = N + dead.length;
  const read = (i) => (i < N ? masks[i] : dead[i - N]);
  const write = (i, m) => (i < N ? (masks[i] = m) : (dead[i - N] = m));
  let tracked = dead.length;
  for (let s = 0; s < N; s++) if (masks[s]) tracked++;
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of TYPES) {
      const bit = BIT[t];
      let fixed = 0, maybe = 0;
      for (let i = 0; i < total; i++) {
        const m = read(i);
        if (m === bit) fixed++;
        else if (m & bit) maybe++;
      }
      if (!maybe) continue;
      const full = fixed === COUNT[t];
      if (!full && !(tracked === ARMY && fixed + maybe === COUNT[t])) continue;
      for (let i = 0; i < total; i++) {
        const m = read(i);
        if (m !== bit && m & bit && (!full || m & ~bit)) write(i, full ? m & ~bit : bit);
      }
      changed = true;
    }
  }
}

// 从一步棋的公开事实里学习：谁动了、怎么动的、交战结果、亮出的军旗。
// 只读己方棋子的兵种，从不读敌方棋子的兵种。返回值：这一步里出现的那个敌子，现在是否已被认出。
export function learn(k, e) {
  const { masks, viewer, enemy } = k;
  let seen = 0;
  let gone = false;
  if (e.side === viewer) {
    if (e.target) {
      seen = masks[e.to] & defenders(e.piece[1], e.result);
      gone = e.result !== "lose";
      masks[e.to] = gone ? 0 : seen;
    }
  } else {
    seen = masks[e.from] & MOBILE; // 能动，就不是地雷和军旗
    if (e.turns) seen &= BIT[1]; // 在铁路上拐了弯，只能是工兵
    if (e.target) seen &= attackers(e.target[1], e.result);
    gone = e.result === "lose" || e.result === "tie";
    masks[e.from] = 0;
    if (!gone) masks[e.to] = seen;
  }
  const flagUp = e.reveal.find((r) => r.color === enemy);
  // 敌子阵亡时，对方亮没亮旗也是公开事实：亮了，阵亡的就是司令；没亮，就不是
  if (gone) k.dead.push(flagUp ? BIT[9] : seen & ~BIT[9]);
  if (flagUp) {
    for (let s = 0; s < N; s++) masks[s] &= ~BIT.F;
    masks[flagUp.sq] = BIT.F;
  }
  settle(k);
  if (!seen) return false;
  return single(gone ? k.dead[k.dead.length - 1] : masks[e.to]);
}

// 某格的敌子若已被认出，返回兵种，否则 null
export const identified = (k, s) => (single(k.masks[s]) ? typeOf(k.masks[s]) : null);

// 一方此刻看到的局面：己方棋子是真的，敌方棋子只剩位置（兵种写成 ?）和信念
export function observe(state, k) {
  const { enemy } = k;
  return {
    me: k.viewer,
    board: state.board.map((p) => (p && p[0] === enemy ? enemy + "?" : p)),
    masks: k.masks,
    dead: k.dead,
    trail: state.history.slice(-16).map(({ side, from, to }) => ({ side, from, to })),
    quiet: state.quiet,
  };
}

// 先验：没动过的后排棋子更像地雷（真实布阵里后两排 10 格有 3 颗雷，远高于平均）
const prior = (mask, type) => (type === "M" ? 2.5 : 1);

// 按信念随机补全一个「可能的世界」：给每个敌子指派一个兵种，既不违背信念，也不超编制。
// 做法是二分图匹配（棋子 ↔ 编制名额）：每个棋子按「先验 × 随机」给名额排序，再用增广路保证一定配得上。
export function sampleWorld(view, rng) {
  const { board, masks, dead, me } = view;
  // 按敌方自己的视角依次处理（从它的底线到第一排），红看黑、黑看红才会消耗同样的随机数、得到镜像的世界
  const cells = [];
  for (let s = 0; s < N; s++) if (masks[s]) cells.push(s);
  if (me === RED) cells.reverse();
  const items = cells.map((s) => masks[s]).concat(dead);
  const prefs = items.map((mask) => {
    const keyed = [];
    for (let j = 0; j < ARMY; j++) if (mask & BIT[SLOTS[j]]) keyed.push([j, -Math.log(1 - rng()) / prior(mask, SLOTS[j])]);
    return keyed.sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  });
  const owner = new Int8Array(ARMY).fill(-1);
  const visited = new Uint8Array(ARMY);
  const seat = (i) => {
    for (const j of prefs[i]) {
      if (visited[j]) continue;
      visited[j] = 1;
      if (owner[j] < 0 || seat(owner[j])) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  };
  // 选择少的先入座，能让大多数棋子拿到自己偏好的名额
  const order = items.map((_, i) => i).sort((a, b) => prefs[a].length - prefs[b].length);
  for (const i of order) {
    visited.fill(0);
    seat(i);
  }
  const world = board.slice();
  const foe = other(me);
  for (let j = 0; j < ARMY; j++) if (owner[j] >= 0 && owner[j] < cells.length) world[cells[owner[j]]] = foe + SLOTS[j];
  // 信念自洽时人人有座；万一没配上（说明推理有漏洞），退回它自己信念里的任意一种，保证棋盘完整
  for (let i = 0; i < cells.length; i++) if (world[cells[i]][1] === "?") world[cells[i]] = foe + typeOf(masks[cells[i]]);
  return world;
}
