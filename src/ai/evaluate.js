/**
 * [INPUT]: 依赖 engine/junqi 的拓扑（CAMP/HQ/STEP/distance/rowOf）、findFlag、movable
 * [OUTPUT]: VALUE（兵种分值）、NEUTRAL（中性权重）、evaluate（一个确定世界的静态估值）
 * [POS]: ai 的估值器。只看一个「兵种全部已知」的棋盘；暗棋的不确定性由 brain 在多个抽样世界上取平均来表达，不进这里。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { N, CAMP, HQ, STEP, HALF, rowOf, rankOf, other, movable, distance, findFlag } from "../engine/junqi.js";

// 单位约为「分」。工兵比排长值钱：只有它能排雷、能在铁路上拐弯。军旗不计分，丢旗即负。
export const VALUE = { 9: 900, 8: 640, 7: 460, 6: 330, 5: 240, 4: 170, 3: 120, 2: 85, 1: 110, B: 300, M: 150, F: 0 };
export const NEUTRAL = { material: 1, advance: 1, attack: 1, defense: 1 };
const STRANDED = 3000; // 一个能动的子都没有：下一手就是「无棋可走」
const LIMIT = 7000; // 估值封顶，保证永远小于搜索里的胜负分

function sideTerms(board, color, enemyFlag, ownFlag) {
  let material = 0, advance = 0, attack = 0, movers = 0, guard = 0;
  // 军旗的三面：自家的雷最稳，自家的子次之，空着是破绽，敌子贴身最危险
  if (ownFlag >= 0)
    for (const t of STEP[ownFlag]) {
      const q = board[t];
      guard += !q ? -25 : q[0] !== color ? -120 : q[1] === "M" ? 45 : 20;
    }
  for (let s = 0; s < N; s++) {
    const p = board[s];
    if (!p || p[0] !== color) continue;
    const type = p[1];
    material += VALUE[type];
    if (!movable(type)) continue;
    if (HQ[s]) {
      advance -= 20 + VALUE[type] * 0.3; // 进了大本营就再也出不来
      continue;
    }
    movers++;
    const row = rowOf(color, rankOf(s));
    advance += row * 3 + (CAMP[s] ? (row >= HALF ? 16 : 6) : 0); // 向前压；占住行营（尤其对方半场的）更稳
    if (enemyFlag < 0) continue;
    const d = distance(s, enemyFlag);
    if (d <= 6) attack += (7 - d) * (d === 1 ? 14 : 5); // 逼近军旗；贴身时威胁陡增
  }
  return { score: material, advance, attack, movers, guard };
}

// 返回值以 me 方为正。性格 w 只调整 me 自己看重什么；对手按中性权重估计。
export function evaluate(board, me, w = NEUTRAL) {
  const foe = other(me);
  const myFlag = findFlag(board, me), foeFlag = findFlag(board, foe);
  const a = sideTerms(board, me, foeFlag, myFlag);
  const b = sideTerms(board, foe, myFlag, foeFlag);
  const mine = a.score * w.material + a.advance * w.advance + a.attack * w.attack + a.guard * w.defense - (a.movers ? 0 : STRANDED);
  const theirs = b.score + b.advance + b.attack * w.defense + b.guard - (b.movers ? 0 : STRANDED);
  return Math.max(-LIMIT, Math.min(LIMIT, Math.round(mine - theirs)));
}
