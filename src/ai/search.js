/**
 * [INPUT]: 依赖 engine/junqi 的 legalMoves、apply、revert、battle、findFlag、STEP；依赖 ai/evaluate 的 evaluate、VALUE
 * [OUTPUT]: MATE（胜负分）、searchWorld（生成器：给一个确定世界里的每个根走法打分）、searchSync（同步版，测试用）
 * [POS]: ai 的推演器。只在「兵种全部已知」的世界里做 alpha-beta；它不知道暗棋的存在，brain 负责喂给它多个抽样世界。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { other, legalMoves, apply, revert, battle, findFlag, STEP } from "../engine/junqi.js";
import { evaluate, VALUE, NEUTRAL } from "./evaluate.js";

// 胜负分故意不取天文数字：brain 要在多个世界上取平均，
// 「八个世界里有一个能夺旗」只该值 MATE / 8 = 1000 分，约等于一个司令，而不是压倒一切。
export const MATE = 8000;
const SLICE = 800; // 每搜这么多节点让出一次，界面不卡
const QUIET_DEPTH = 3;

// 着法排序：夺旗 > 吃子（吃大的、用小的吃）> 兑子 > 普通走子 > 送死
function gain(m) {
  if (m.result === "move") return 0;
  if (m.result === "flag") return 1e6;
  const v = VALUE[m.target[1]], mine = VALUE[m.piece[1]];
  return m.result === "win" ? 2000 + v * 4 - mine / 8 : m.result === "tie" ? 1000 + v - mine : -mine;
}
const byGain = (a, b) => b.order - a.order;
// 静态搜索只看「不亏的交战」：吃子，或者拿便宜的换贵的
const worth = (m) => m.result === "win" || (m.result === "tie" && VALUE[m.target[1]] >= VALUE[m.piece[1]]);

/**
 * 生成器：yield 期间搜索在进行；返回 { scores, nodes }，scores[i] 是 roots[i] 在这个世界里的得分（me 方为正）。
 * roots 只带 from/to：同一步棋在不同的世界里对上的敌子不同，战果在这里现算。
 * 结果只取决于世界、深度和性格，与时间片怎么切无关。
 */
export function* searchWorld(world, me, roots, { depth = 2, persona = NEUTRAL } = {}) {
  const board = world.slice();
  let nodes = 0;
  const stand = (color) => (color === me ? 1 : -1) * evaluate(board, me, persona);

  // 军旗被敌子贴身：对方下一手就能夺旗。军旗不会动，位置在这个世界里固定。
  const flags = { [me]: findFlag(board, me), [other(me)]: findFlag(board, other(me)) };
  const besieged = (color) => flags[color] >= 0 && STEP[flags[color]].some((t) => board[t] && board[t][0] !== color);

  function* quiesce(color, alpha, beta, qd, ply) {
    if (++nodes % SLICE === 0) yield;
    const list = legalMoves(board, color);
    for (const m of list) if (m.result === "flag") return MATE - ply;
    if (!list.length) return -MATE + ply; // 无棋可走判负
    // 平时可以「按兵不动」，只多看不亏的交战；军旗被贴身时不行，所有应法都得看一遍
    const pressed = qd > 0 && besieged(color);
    let best = pressed ? -Infinity : stand(color);
    if (!pressed) {
      if (qd <= 0 || best >= beta) return best;
      if (best > alpha) alpha = best;
    }
    const tries = pressed ? list : list.filter(worth);
    for (const m of tries) m.order = gain(m);
    for (const m of tries.sort(byGain)) {
      apply(board, m);
      const v = -(yield* quiesce(other(color), -beta, -alpha, qd - 1, ply + 1));
      revert(board, m);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function* negamax(color, d, alpha, beta, ply) {
    if (d <= 0) return yield* quiesce(color, alpha, beta, QUIET_DEPTH, ply);
    if (++nodes % SLICE === 0) yield;
    const list = legalMoves(board, color);
    if (!list.length) return -MATE + ply; // 无棋可走判负
    for (const m of list) {
      if (m.result === "flag") return MATE - ply;
      m.order = gain(m);
    }
    let best = -Infinity;
    for (const m of list.sort(byGain)) {
      apply(board, m);
      const v = -(yield* negamax(other(color), d - 1, -beta, -alpha, ply + 1));
      revert(board, m);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 根节点每个走法都用全窗口，拿精确分：brain 要对多个世界取平均、算波动，
  // 被窗口裁剪的「上界」会把「这个世界里会丢旗」记成一个不痛不痒的分数。
  const scores = new Float64Array(roots.length);
  for (let i = 0; i < roots.length; i++) {
    const { from, to } = roots[i];
    const piece = board[from], target = board[to];
    const m = { from, to, piece, target, result: target ? battle(piece[1], target[1]) : "move" };
    if (m.result === "flag") scores[i] = MATE;
    else {
      apply(board, m);
      scores[i] = -(yield* negamax(other(me), depth - 1, -Infinity, Infinity, 1));
      revert(board, m);
    }
  }
  return { scores, nodes };
}

export function searchSync(world, me, roots, opts) {
  const it = searchWorld(world, me, roots, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
