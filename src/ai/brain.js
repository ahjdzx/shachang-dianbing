/**
 * [INPUT]: 依赖 engine/junqi 的 legalMoves；依赖 ai/knowledge 的 sampleWorld、single；依赖 ai/search 的 searchWorld、MATE；
 *          依赖 ai/evaluate 的 evaluate；依赖 ai/formations 的 deploy
 * [OUTPUT]: PERSONAS、createArmy（性格 + 布阵）、think（生成器：选一步棋）、winRate（全知胜率）、fogRate（暗棋视角胜率）
 * [POS]: ai 的决策者。它只接收 knowledge.observe() 给的视图：先按信念抽样出若干个可能的世界，
 *        每个世界交给 search 推演，再对走法取平均、按胆量加减波动，最后用温度抽选。它只会从合法走法里选。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { N, RED, legalMoves } from "../engine/junqi.js";
import { sampleWorld, single } from "./knowledge.js";
import { searchWorld, MATE } from "./search.js";
import { evaluate } from "./evaluate.js";
import { deploy } from "./formations.js";

// nerve 胆量：正数偏爱结果起伏大的走法（敢拿大子去撞暗子），负数宁可稳一点
export const PERSONAS = [
  { key: "blitz", name: "闪电战", weights: { material: 1, advance: 1.5, attack: 1.6, defense: 0.8 }, nerve: 0.15, formations: ["铁路快攻", "中路突破"] },
  { key: "wall", name: "铁壁", weights: { material: 1.05, advance: 0.7, attack: 0.8, defense: 1.8 }, nerve: -0.35, formations: ["三角雷", "空城计"] },
  { key: "fox", name: "诡道", weights: { material: 0.95, advance: 1.1, attack: 1.2, defense: 1.1 }, nerve: 0, formations: ["空城计", "铁路快攻"] },
  { key: "siege", name: "步步为营", weights: { material: 1.1, advance: 1, attack: 1, defense: 1.3 }, nerve: -0.15, formations: ["三角雷", "中路突破"] },
];

export function createArmy(rng, color) {
  const persona = rng.pick(PERSONAS);
  return { color, persona, formation: deploy(rng, rng.pick(persona.formations)) };
}

// 每个深度抽多少个世界、第二轮精算多少个走法。越深越贵，所以抽得越少、算得越窄。
const SAMPLES = { 2: 10, 3: 8, 4: 6 };
const WIDTH = { 2: 14, 3: 10, 4: 7 };
const SHUFFLE = 35; // 来回走同一步，每重复一次扣这么多分
const RESTLESS = 1.5; // 久不交战，每多一步，主动开战多加这么多分（封顶 60 步）

// 温度 → softmax 的「分差容忍度」：低温几乎只走最好的，高温才会在接近的几步间游移
export const tauOf = (t) => 6 + t * t * 160;
export const marginOf = (t) => (t <= 0.001 ? 0 : Math.max(40 + t * 260, 170));

// 胜率（红方）。全知版给观战用；暗棋版只用一方看得见的东西：在它的信念里抽若干个世界，取估值的平均。
const FOG_SAMPLES = 12;
const toRate = (score) => 1 / (1 + Math.exp(-score / 700));
export const winRate = (board) => toRate(evaluate(board, RED));
export function fogRate(view, rng) {
  let sum = 0;
  for (let i = 0; i < FOG_SAMPLES; i++) sum += evaluate(sampleWorld(view, rng), RED);
  return toRate(sum / FOG_SAMPLES);
}

// 对公开的走子记录数一数：这一步（或它的回头路）自己最近走过几次
function wander(view, move) {
  let n = 0;
  for (const t of view.trail) if (t.side === view.me && ((t.from === move.from && t.to === move.to) || (t.from === move.to && t.to === move.from))) n++;
  return n;
}

/**
 * 生成器：yield 期间在推演；返回 { move: { from, to }, kind, roots, nodes }，无棋可走时返回 null。
 * temperature 0..1；depth 2..4。
 */
export function* think(view, army, rng, { temperature = 0.35, depth = 2 } = {}) {
  const { me, board } = view;
  // 走法按己方视角排序（红方看格子号，黑方倒着看）。同分时排在前面的占便宜，
  // 不这样排，红方同分时偏爱后排的子、黑方偏爱前排的子，两边就不是同一个棋手了。
  const own = (s) => (me === RED ? s : N - 1 - s);
  const moves = legalMoves(board, me).map(({ from, to }) => ({ from, to })).sort((a, b) => own(a.from) - own(b.from) || own(a.to) - own(b.to));
  if (!moves.length) return null;
  const { weights, nerve } = army.persona;
  const certain = view.masks.every((m) => !m || single(m)); // 明棋，或敌子已全部认出：只有一个世界
  const worlds = Array.from({ length: certain ? 1 : SAMPLES[depth] || 8 }, () => sampleWorld(view, rng));
  let nodes = 0;

  // 一轮推演：每个世界各搜一遍，按走法汇总成均值与波动，再折算成一个分数
  function* survey(list, d) {
    const sum = new Float64Array(list.length), sq = new Float64Array(list.length);
    for (const world of worlds) {
      const r = yield* searchWorld(world, me, list, { depth: d, persona: weights });
      nodes += r.nodes;
      r.scores.forEach((v, i) => ((sum[i] += v), (sq[i] += v * v)));
    }
    return list.map((move, i) => {
      const mean = sum[i] / worlds.length;
      const spread = Math.sqrt(Math.max(0, sq[i] / worlds.length - mean * mean));
      const fight = board[move.to] ? Math.min(view.quiet, 60) * RESTLESS : -wander(view, move) * SHUFFLE;
      return { move, mean, spread, score: mean + nerve * spread + fight };
    });
  }
  const byScore = (a, b) => b.score - a.score;

  // 第一轮：只看这一步和对方的吃子反击，筛出值得细算的；第二轮：对前几名按完整深度重算
  let roots = (yield* survey(moves, 1)).sort(byScore);
  if (depth > 1 && roots.length > 1) {
    const deep = (yield* survey(roots.slice(0, WIDTH[depth] || 10).map((r) => r.move), depth)).sort(byScore);
    const floor = deep[deep.length - 1].score - 1;
    roots = deep.concat(roots.slice(deep.length).map((r) => ({ ...r, score: Math.min(r.score, floor) })));
  }
  const pick = (r, kind) => ({ move: r.move, kind, roots, nodes });
  const best = roots[0].score;
  // 胜负已分（多数世界里都能夺旗，或都要丢旗），或温度为零：不再随机
  if (roots.length === 1 || temperature <= 0.001 || Math.abs(roots[0].mean) > MATE / 2) return pick(roots[0], "best");

  // 故意的失误：只有高温下才会出现
  if (roots.length > 4 && rng.chance(temperature > 0.55 ? (temperature - 0.55) * 0.3 : 0)) {
    const pool = roots.slice(2, 10).filter((r) => r.mean > -MATE / 2);
    if (pool.length) return pick(rng.pick(pool), "blunder");
  }
  // 温度 softmax：在若干个最好的走法里按分数加权抽一个
  const tau = tauOf(temperature);
  const top = roots.filter((r) => r.score > best - marginOf(temperature)).slice(0, 6);
  const odds = top.map((r) => Math.exp((r.score - best) / tau));
  let u = rng() * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) {
    u -= odds[i];
    if (u <= 0) return pick(top[i], i === 0 ? "best" : "soft");
  }
  return pick(top[0], "best");
}
