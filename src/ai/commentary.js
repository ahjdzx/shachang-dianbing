/**
 * [INPUT]: 依赖 engine/junqi 的 NAMES、VERDICT、coord、CAMP、HQ、homeOf、RED
 * [OUTPUT]: describe（一步棋的记谱 + 一句解说，可按观众的所知遮住敌子兵种）、endComment
 * [POS]: ai 的解说员。只读走法记录，不改任何状态。同一步棋对三种观众（全知、红方、黑方）各说一遍，
 *        由 game/match 告诉它每位观众认不认得交战双方。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { NAMES, VERDICT, coord, CAMP, HQ, homeOf, RED } from "../engine/junqi.js";

const SIDE = { r: "红", b: "黑" };
const EVERYTHING = { piece: true, target: true };

// seen = { piece, target }：观众认不认得进攻方、防守方。认不出的敌子叫「暗子」，并附上能推出的范围。
export function describe(e, seen = EVERYTHING) {
  const A = e.piece[1], D = e.target ? e.target[1] : null;
  const who = (code, known) => SIDE[code[0]] + (known ? NAMES[code[1]] : "方暗子");
  const a = who(e.piece, seen.piece);
  const d = e.target ? who(e.target, seen.target) : "";
  const notation = `${seen.piece ? NAMES[A] : "暗子"} ${coord(e.from)}${D ? "×" : "→"}${coord(e.to)}${D ? " " + VERDICT[e.result] : ""}`;
  const both = seen.piece && seen.target;
  let line;
  if (e.result === "flag") line = `夺旗！${a}拔下${SIDE[e.target[0]]}方军旗`;
  else if (e.result === "win") {
    if (A === "1" && D === "M") line = `排雷成功，${a}挖掉了${d}`;
    else line = `${a}吃掉${d}` + (both ? "" : seen.piece ? `（对方比${NAMES[A]}小）` : `（它比${NAMES[D]}大）`);
  } else if (e.result === "lose") {
    if (both) line = D === "M" ? `踩雷！${a}触雷阵亡` : `${a}撞上${d}，阵亡`;
    else if (seen.piece) line = `${a}进攻失利（对方比${NAMES[A]}大${A === "1" ? "" : "，或是地雷"}）`;
    else line = D === "M" ? `${a}触雷阵亡` : `${a}撞上${d}，阵亡（它比${NAMES[D]}小）`;
  } else if (e.result === "tie") {
    if (both) line = A === "B" || D === "B" ? `轰！${a}与${d}同归于尽` : `${a}与${d}兑子，同归于尽`;
    else if (seen.piece) line = A === "B" ? `轰！${a}炸掉了${d}` : `${a}与${d}同归于尽（对方是${NAMES[A]}或炸弹）`;
    else line = D === "B" ? `轰！${d}炸掉了来犯的${a}` : `${a}与${d}同归于尽（它是${NAMES[D]}或炸弹）`;
  } else {
    const crossed = homeOf(e.from) !== homeOf(e.to);
    if (e.turns) line = `${a}沿铁路拐弯，飞到 ${coord(e.to)}`;
    else if (e.path.length > 2) line = `${a}乘铁路${crossed ? "越过前线，直插" : "调往"} ${coord(e.to)}`;
    else if (CAMP[e.to]) line = `${a}进驻行营 ${coord(e.to)}`;
    else if (HQ[e.to]) line = `${a}退进大本营，从此不能再动`;
    else if (crossed) line = `${a}越过前线`;
    else line = `${a} ${coord(e.from)}→${coord(e.to)}`;
  }
  for (const r of e.reveal) line += `；${SIDE[r.color]}方司令阵亡，军旗亮出`;
  return { notation, comment: line };
}

export function endComment(outcome) {
  if (!outcome.over) return "";
  if (!outcome.winner) return `和棋：${outcome.reason}`;
  return `${outcome.winner === RED ? "红" : "黑"}方胜：${outcome.reason}`;
}
