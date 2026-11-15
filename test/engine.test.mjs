/**
 * [INPUT]: 依赖 src/engine/junqi.js 的全部导出
 * [OUTPUT]: 无导出。运行后打印逐项结果，有失败则进程退出码为 1
 * [POS]: test 的规则关卡。只测裁判（引擎），不碰 AI。CI 和 `npm test` 先跑它。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as J from "../src/engine/junqi.js";

let failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
};
const empty = () => new Array(J.N).fill(null);
const put = (b, x, y, p) => (b[J.sq(x, y)] = p);
// 最小可下的棋盘：双方军旗各在大本营
const bare = () => {
  const b = empty();
  put(b, 1, 0, "rF");
  put(b, 1, 11, "bF");
  return b;
};
const targets = (b, x, y) => J.pieceMoves(b, J.sq(x, y)).map((m) => J.coord(m.to));
const move = (b, from, to) => J.legalMoves(b, b[from][0]).find((m) => m.from === from && m.to === to);
const at = (name) => J.sq("ABCDE".indexOf(name[0]), Number(name.slice(1)) - 1);

console.log("棋盘拓扑与自检");
{
  const t = J.selfTest();
  ok(t.ok, "selfTest 通过", JSON.stringify(t));
  ok(J.perft(J.initialBoard(), J.RED, 1) === 34, "perft 1 = 34");
  ok(J.perft(J.initialBoard(), J.RED, 2) === 1159, "perft 2 = 1159");
  const p3 = J.perft(J.initialBoard(), J.RED, 3);
  ok(p3 === 36185, "perft 3 = 36185", `got ${p3}`);
  ok(J.STEP[at("B3")].length === 8 && J.STEP[at("C4")].length === 8, "行营八面通");
  ok(J.STEP[at("A1")].length === 2 && J.STEP[at("C1")].length === 3, "底线只连公路");
  ok(!J.STEP[at("B6")].includes(at("B7")) && !J.STEP[at("D6")].includes(at("D7")), "山界过不去（B、D 两列）");
  ok(J.STEP[at("A6")].includes(at("A7")) && J.STEP[at("C6")].includes(at("C7")) && J.STEP[at("E6")].includes(at("E7")), "前线三条铁路相通（A、C、E 三列）");
  ok(J.distance(at("A1"), at("A2")) === 1 && J.distance(at("B1"), at("B12")) === 11, "站间步数");
}

console.log("布阵规则");
{
  const L = (rows) => J.layoutError(J.parseLayout(rows));
  ok(L(["MFM22", "1M131", "5.B.4", "6B.37", "4.2.5", "73986"]) === null, "标准布阵合规");
  ok(J.layoutError(J.mirrorLayout(J.STANDARD)) === null, "左右镜像后仍合规");
  ok(/大本营/.test(L(["FMM22", "1M131", "5.B.4", "6B.37", "4.2.5", "73986"]) || ""), "军旗不在大本营 → 违规");
  ok(/后两排/.test(L(["2F2M2", "1M131", "5.B.4", "6B.37", "4.M.5", "73986"]) || ""), "地雷出了后两排 → 违规");
  ok(/第一排/.test(L(["MFM22", "1M131", "5.8.4", "6B.37", "4.2.5", "739B6"]) || ""), "炸弹在第一排 → 违规");
  ok(/行营/.test(L(["MFM22", "1M131", "53B.4", "6B.37", "4.2.5", "73986"]) || ""), "行营里摆了子 → 违规");
  ok(/超编/.test(L(["MFM22", "1M131", "5.B.4", "6B.37", "4.2.5", "79986"]) || ""), "两个司令 → 违规");
  const b = J.initialBoard();
  ok(b[at("B1")] === "rF" && b[at("D12")] === "bF" && b[at("C6")] === "r9" && b[at("C7")] === "b9", "黑方布阵转 180° 摆放");
  ok(b.filter((p) => p && p[0] === "r").length === 25 && b.filter((p) => p && p[0] === "b").length === 25, "双方各 25 子");
}

console.log("走法");
{
  const b = bare();
  put(b, 2, 0, "rM");
  put(b, 3, 0, "r9");
  put(b, 2, 2, "r5");
  ok(targets(b, 2, 0).length === 0 && targets(b, 1, 0).length === 0, "地雷、军旗不能动");
  ok(targets(b, 3, 0).length === 0, "进了大本营的棋子不能再动");
  ok(targets(b, 2, 2).sort().join() === "B3,C2,C4,D3", "公路一步：四邻（含左右两个行营）");
}
{
  const b = bare();
  put(b, 0, 1, "r5");
  let t = targets(b, 0, 1);
  ok(t.includes("A11") && t.includes("E2") && !t.includes("A12") && !t.includes("B6") && !t.includes("B11"), "铁路直行到底：A2 可达 A11、E2，下不了对方底线，也不能拐弯");
  ok(t.includes("A1") && t.includes("B3"), "铁路站同样能走公路一步（下底线、进行营）");
  put(b, 0, 4, "r3");
  put(b, 3, 1, "b4");
  t = targets(b, 0, 1);
  ok(t.includes("A4") && !t.includes("A5") && !t.includes("A6"), "铁路上被己方挡住即停");
  ok(t.includes("D2") && !t.includes("E2"), "铁路上吃到敌子即停，不能越子");
}
{
  const b = bare();
  put(b, 0, 1, "r1");
  let t = targets(b, 0, 1);
  ok(t.includes("C6") && t.includes("C7") && t.includes("E11") && t.includes("B11"), "工兵沿铁路任意拐弯");
  ok(!t.includes("C3") && !t.includes("C5"), "工兵也只在铁路上飞，不上公路");
  put(b, 0, 2, "r2");
  put(b, 1, 1, "r2");
  t = targets(b, 0, 1);
  ok(t.sort().join() === "A1,B3", "工兵两头被堵：只剩公路一步（下底线、进行营）", t.join());
  const c = bare();
  put(c, 0, 5, "r1");
  put(c, 2, 5, "b3");
  put(c, 4, 5, "b2");
  const m = move(c, at("A6"), at("E6"));
  ok(!!m && m.result === "lose", "直线被挡时工兵绕道攻击", JSON.stringify(m));
  const g = J.createGame(c, J.RED);
  const e = J.play(g, m);
  ok(e.turns && e.rail && e.path[0] === at("A6") && e.path[e.path.length - 1] === at("E6") && e.path.includes(at("A7")), "记录里有拐弯路径", e.path.map(J.coord).join(">"));
}
{
  const b = bare();
  put(b, 1, 2, "b2"); // 黑排长躲在红方行营
  put(b, 1, 1, "r9");
  put(b, 2, 3, "r3");
  ok(!targets(b, 1, 1).includes("B3"), "行营里的棋子不受攻击");
  ok(targets(b, 1, 2).includes("C4") === false && targets(b, 1, 2).includes("B2") === true, "行营里的棋子照常出击；别的行营有子就进不去");
  ok(targets(b, 2, 3).length === 8 - 1, "行营八个方向，被占的行营除外");
}

console.log("战斗");
{
  const R = (a, d) => J.battle(a, d);
  ok(R("9", "8") === "win" && R("2", "3") === "lose" && R("5", "5") === "tie", "军衔大吃小，同级同归于尽");
  ok(R("B", "9") === "tie" && R("9", "B") === "tie" && R("B", "M") === "tie", "炸弹与任何棋子同归于尽");
  ok(R("1", "M") === "win" && R("9", "M") === "lose" && R("2", "M") === "lose", "只有工兵能排雷，其余踩雷阵亡");
  ok(R("1", "F") === "flag" && R("B", "F") === "flag", "任何能动的棋子都能夺旗");
  ok(R("1", "2") === "lose" && R("2", "1") === "win", "工兵军衔最低");
}

console.log("对局记录、撤销与终局");
{
  const b = bare();
  put(b, 0, 5, "r9");
  put(b, 0, 6, "bB");
  put(b, 4, 5, "r3");
  put(b, 4, 6, "b5");
  const g = J.createGame(b, J.RED);
  const before = J.keyOf(g.board, g.side);
  const e1 = J.play(g, move(g.board, at("A6"), at("A7")));
  ok(e1.result === "tie" && !g.board[at("A6")] && !g.board[at("A7")], "司令撞炸弹：两子都移除");
  ok(e1.reveal.length === 1 && e1.reveal[0].color === "r" && e1.reveal[0].sq === at("B1"), "司令阵亡 → 亮出本方军旗");
  ok(e1.notation === "司令 A6×A7 同归", "记谱", e1.notation);
  const e2 = J.play(g, move(g.board, at("E7"), at("E6")));
  ok(e2.result === "win" && g.board[at("E6")] === "b5" && !g.board[at("E7")], "团长吃连长并占位");
  ok(g.quiet === 0 && g.ply === 2, "交战后无战步数清零");
  J.undo(g);
  J.undo(g);
  ok(J.keyOf(g.board, g.side) === before && g.ply === 0 && g.history.length === 0 && g.seen.size === 1, "撤销回到原局面");
}
{
  const b = bare();
  put(b, 1, 10, "r1"); // 红工兵在黑方军旗正前方
  put(b, 4, 6, "b2");
  const g = J.createGame(b, J.RED);
  ok(!J.outcome(g).over, "对局进行中");
  const e = J.play(g, move(g.board, at("B11"), at("B12")));
  const o = J.outcome(g);
  ok(e.result === "flag" && o.over && o.winner === "r" && o.reason === "夺旗", "夺旗即胜", JSON.stringify(o));
}
{
  const b = bare();
  put(b, 3, 0, "r9"); // 红方唯一能动的子陷在大本营里
  put(b, 0, 0, "rM");
  put(b, 4, 6, "b2");
  const o = J.outcome(J.createGame(b, J.RED));
  ok(o.over && o.winner === "b" && o.reason === "无棋可走", "无棋可走判负", JSON.stringify(o));
}
{
  const b = bare();
  put(b, 2, 2, "r5");
  put(b, 2, 9, "b5");
  const g = J.createGame(b, J.RED);
  const seq = [["C3", "C2"], ["C10", "C11"], ["C2", "C3"], ["C11", "C10"], ["C3", "C2"], ["C10", "C11"], ["C2", "C3"], ["C11", "C10"]];
  for (const [f, t] of seq) J.play(g, move(g.board, at(f), at(t)));
  ok(J.outcome(g).over && J.outcome(g).reason === "三次重复局面", "三次重复局面判和", JSON.stringify(J.outcome(g)));
}

console.log(failed ? `\n${failed} 项失败` : "\n规则引擎全部通过");
process.exitCode = failed ? 1 : 0;
