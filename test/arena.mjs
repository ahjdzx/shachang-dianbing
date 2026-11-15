/**
 * [INPUT]: 依赖 game/match 的 createMatch、decide、commit；依赖 ai/knowledge 的 single、typeOf（核对信念）
 * [OUTPUT]: 无导出。打印每盘的结果与汇总：胜负和比例、平均步数、每步耗时、信念是否始终包含真相
 * [POS]: test 的对局场。不是断言测试，是调 AI 时看全貌用的量尺（`npm run bench`）。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 用法：node test/arena.mjs [盘数=12] [深度=2] [温度=0.35] [mode=dark]
import { createMatch, decide, commit } from "../src/game/match.js";
import { TYPES, N } from "../src/engine/junqi.js";

const games = Number(process.argv[2] || 12);
const depth = Number(process.argv[3] || 2);
const temperature = Number(process.argv[4] || 0.35);
const mode = process.argv[5] || "dark";

// 信念必须始终包含真相：每个活着的敌子，真实兵种都得在对方的候选里
function sound(match) {
  for (const v of ["r", "b"]) {
    const k = match.know[v];
    for (let s = 0; s < N; s++) {
      const p = match.state.board[s];
      if (p && p[0] === k.enemy && !(k.masks[s] & (1 << TYPES.indexOf(p[1])))) return false;
      if ((!p || p[0] !== k.enemy) && k.masks[s]) return false;
    }
  }
  return true;
}

const tally = { r: 0, b: 0, draw: 0 };
const reasons = {};
let plies = 0, ms = 0, moves = 0, worst = 0, unsound = 0, battles = 0;
for (let i = 0; i < games; i++) {
  const match = createMatch("ARENA" + i, { depth, temperature, mode });
  let ok = true;
  while (!match.result.over) {
    const t = Date.now();
    const it = decide(match);
    let r = it.next();
    while (!r.done) r = it.next();
    const dt = Date.now() - t;
    ms += dt;
    moves++;
    worst = Math.max(worst, dt);
    const rec = commit(match, r.value);
    if (rec.target) battles++;
    if (ok && !sound(match)) ok = false;
  }
  if (!ok) unsound++;
  const res = match.result;
  tally[res.winner || "draw"]++;
  reasons[res.reason] = (reasons[res.reason] || 0) + 1;
  plies += match.log.length;
  const left = (c) => match.state.board.filter((p) => p && p[0] === c).length;
  console.log(`ARENA${i} ${match.armies.r.persona.name}·${match.armies.r.formation.name} vs ${match.armies.b.persona.name}·${match.armies.b.formation.name}：${res.winner ? (res.winner === "r" ? "红胜" : "黑胜") : "和"}（${res.reason}，${match.log.length} 步，余子 ${left("r")}:${left("b")}）${ok ? "" : " ✗ 信念出错"}`);
}
console.log(`\n${games} 盘（深度 ${depth}，温度 ${temperature}，${mode === "open" ? "明棋" : "暗棋"}）：红 ${tally.r} 胜，黑 ${tally.b} 胜，和 ${tally.draw}`);
console.log(`终局原因：${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join("，")}`);
console.log(`平均 ${Math.round(plies / games)} 步，其中交战 ${Math.round(battles / games)} 次；每步平均 ${Math.round(ms / moves)} ms，最慢 ${worst} ms；信念出错 ${unsound} 盘`);
