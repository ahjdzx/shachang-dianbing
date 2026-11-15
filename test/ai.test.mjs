/**
 * [INPUT]: 依赖 game/match 的 createMatch、decide、commit、startTurn、runSync、visible；依赖 ai/knowledge、ai/search、ai/formations、ai/brain；依赖 engine/junqi
 * [OUTPUT]: 无导出。运行后打印逐项结果，有失败则进程退出码为 1
 * [POS]: test 的 AI 关卡。重点守三条线：信念永远包含真相、电脑看不到对方兵种、同一种子（连同脚本）精确复现。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { runSync, createMatch, decide, commit, startTurn, visible, LEVELS } from "../src/game/match.js";
import { createKnowledge, learn, observe, sampleWorld, identified } from "../src/ai/knowledge.js";
import { searchSync, MATE } from "../src/ai/search.js";
import { FORMATIONS, deploy, arrange } from "../src/ai/formations.js";
import { PERSONAS } from "../src/ai/brain.js";
import { makeRng } from "../src/ai/rng.js";
import * as J from "../src/engine/junqi.js";

let failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) console.log("  ✓", name, extra);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
};
const at = (name) => J.sq("ABCDE".indexOf(name[0]), Number(name.slice(1)) - 1);
const finish = (it) => {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
};
const bit = (type) => 1 << J.TYPES.indexOf(type);
const moveOf = (b, from, to) => J.legalMoves(b, b[from][0]).find((m) => m.from === from && m.to === to);
const rootsOf = (b, side) => J.legalMoves(b, side).map(({ from, to }) => ({ from, to }));
const bestOf = (b, side, depth = 2) => {
  const roots = rootsOf(b, side);
  const { scores } = searchSync(b, side, roots, { depth });
  let i = 0;
  scores.forEach((v, k) => v > scores[i] && (i = k));
  return { ...roots[i], score: scores[i] };
};

console.log("阵型库");
{
  const names = Object.keys(FORMATIONS);
  ok(names.every((n) => J.layoutError(arrange(n).layout) === null && J.layoutError(arrange(n, true).layout) === null), `${names.length} 套阵型原样和镜像都合规`, names.join(" "));
  ok(names.every((n) => FORMATIONS[n].note.length > 0 && FORMATIONS[n].note.length <= 18), "每套阵型有一句给人看的说明");
  ok(PERSONAS.every((p) => p.formations.every((f) => f in FORMATIONS)), "每种性格偏好的阵型都在库里");
  let bad = 0, trapped = 0;
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const rng = makeRng("DEPLOY" + i);
    const d = deploy(rng, rng.pick(names));
    if (J.layoutError(d.layout)) bad++;
    if (d.layout.some((t, k) => J.HQ[k] && t >= "4" && t <= "9")) trapped++;
    seen.add(d.layout.join(""));
  }
  ok(bad === 0, "400 次随机布阵（镜像 + 对调军官）全部合规");
  ok(trapped === 0, "大本营里从不摆营长以上的军官（进去就动不了）");
  ok(seen.size > 100, `布阵有足够的变化（${seen.size} 种）`);
}

console.log("信念（暗棋推理）");
{
  const board = J.initialBoard();
  const k = createKnowledge("r", board);
  const view = observe(J.createGame(board), k);
  ok(view.board.every((p) => !p || p[0] === "r" || p === "b?"), "视图里敌子只剩位置，没有兵种");
  ok(!(k.masks[at("C7")] & (bit("B") | bit("M") | bit("F"))), "第一排不会是炸弹、地雷、军旗");
  ok(!(k.masks[at("C9")] & bit("M")) && k.masks[at("C11")] & bit("M"), "地雷只可能在后两排");
  ok(k.masks[at("B12")] & bit("F") && k.masks[at("D12")] & bit("F") && !(k.masks[at("C12")] & bit("F")), "军旗只可能在两个大本营");
  const rng = makeRng("SAMPLE");
  let fine = true;
  for (let i = 0; i < 200 && fine; i++) {
    const w = sampleWorld(view, rng);
    const n = {};
    for (let s = 0; s < J.N; s++) {
      if (!w[s]) continue;
      if (w[s][0] === "r") fine &&= w[s] === board[s];
      else {
        n[w[s][1]] = (n[w[s][1]] || 0) + 1;
        fine &&= !!(k.masks[s] & bit(w[s][1]));
      }
    }
    fine &&= J.TYPES.every((t) => n[t] === J.COUNT[t]);
  }
  ok(fine, "200 个抽样世界：己方不变，敌方符合信念且正好满编");
}
{
  // 黑工兵在铁路上拐弯 → 红方认出它是工兵
  const b = new Array(J.N).fill(null);
  b[at("B1")] = "rF"; b[at("B12")] = "bF"; b[at("A11")] = "b1"; b[at("C3")] = "r5"; b[at("E9")] = "b7";
  const g = J.createGame(b, "b");
  const k = createKnowledge("r", g.board);
  ok(identified(k, at("A11")) === null, "走之前认不出");
  const known = learn(k, J.play(g, moveOf(g.board, at("A11"), at("C7"))));
  ok(known && identified(k, at("C7")) === "1" && !k.masks[at("A11")], "铁路上拐弯 → 只能是工兵；信念跟着棋子走");
  // 红团长进攻 E9 的暗子失利 → 对方比团长大，或是地雷；能动之后排除地雷
  const g2 = J.createGame(b, "r");
  const k2 = createKnowledge("r", g2.board);
  const b2 = g2.board;
  b2[at("C3")] = null; b2[at("E8")] = "r5";
  learn(k2, J.play(g2, moveOf(b2, at("E8"), at("E9"))));
  const m = k2.masks[at("E9")];
  ok(m & bit("7") && m & bit("9") && !(m & bit("5")) && !(m & bit("3")) && !(m & bit("B")), "进攻失利 → 对方军衔更高（同级和炸弹会同归于尽）");
}
{
  // 司令阵亡 → 军旗亮出
  const m = createMatch("FLAGUP", { mode: "dark" });
  const b = m.state.board;
  const r9 = b.indexOf("r9"), bB = b.indexOf("bB");
  // 手工把红司令挪到黑炸弹面前（只为制造一次司令阵亡）
  const spot = J.STEP[bB].find((t) => !b[t] && !J.CAMP[t]) ?? J.STEP[bB].find((t) => !b[t]);
  ok(spot !== undefined, "找到炸弹旁的空位");
  b[r9] = null; b[spot] = "r9";
  m.know.b = createKnowledge("b", b);
  const flag = b.indexOf("rF");
  ok(!visible(m, "b", flag), "司令在时，黑方看不出红方军旗");
  const rec = commit(m, { move: { from: spot, to: bB }, kind: "human" });
  ok(rec.result === "tie" && rec.reveal.length === 1 && visible(m, "b", flag) && identified(m.know.b, flag) === "F", "红司令撞炸弹阵亡 → 黑方认出红方军旗");
  ok(/黑炸弹/.test(rec.text.r.comment), "同归于尽而对方没亮旗 → 那不是司令，只能是炸弹", rec.text.r.comment);
  ok(/红司令/.test(rec.text.b.comment) && !/暗子/.test(rec.text.b.comment), "对方亮旗 → 阵亡的就是司令：黑方也认得出", rec.text.b.comment);
}

console.log("推演");
{
  const b = new Array(J.N).fill(null);
  b[at("B1")] = "rF"; b[at("B12")] = "bF"; b[at("B11")] = "r2"; b[at("E7")] = "b9"; b[at("E6")] = "r3";
  const best = bestOf(b, "r");
  ok(best.to === at("B12") && best.score === MATE, "能夺旗就夺旗");
}
{
  const b = new Array(J.N).fill(null);
  b[at("B1")] = "rF"; b[at("D12")] = "bF"; b[at("A6")] = "r7"; b[at("A7")] = "b4"; b[at("C8")] = "b8"; b[at("C3")] = "r2";
  const best = bestOf(b, "r");
  ok(best.from === at("A6") && best.to === at("A7"), "吃掉送上门的营长");
}
{
  // 黑工兵已经贴住红方军旗：红方必须马上吃掉它，而不是去吃远处更大的子
  const b = new Array(J.N).fill(null);
  b[at("B1")] = "rF"; b[at("D12")] = "bF"; b[at("B2")] = "b1"; b[at("C2")] = "r2"; b[at("E6")] = "r9"; b[at("E7")] = "b8"; b[at("A1")] = "rM"; b[at("C1")] = "rM";
  const best = bestOf(b, "r");
  ok(best.from === at("C2") && best.to === at("B2"), "军旗被贴身 → 先解围", `${J.coord(best.from)}→${J.coord(best.to)}`);
  // 提前一步：黑工兵还差一步贴身，红方轮走。深度 2 也要看见「不管它就丢旗」
  const c = new Array(J.N).fill(null);
  c[at("B1")] = "rF"; c[at("D12")] = "bF"; c[at("A1")] = "rM"; c[at("C1")] = "rM"; c[at("B2")] = "rM"; c[at("A2")] = "b1"; c[at("C3")] = "r4"; c[at("E6")] = "r9"; c[at("E7")] = "b8";
  const { scores } = searchSync(c, "r", rootsOf(c, "r"), { depth: 2 });
  const roots = rootsOf(c, "r");
  const idle = roots.findIndex((r) => r.from === at("E6") && r.to === at("E7"));
  ok(scores[idle] < -MATE / 2 || Math.max(...scores) > scores[idle], "工兵要来挖雷时，贪吃远处的子不是最佳");
}

console.log("电脑不偷看");
{
  // 两盘棋的真相不同（黑方两个没露过面的军官对调了位置），但红方看到的一模一样 → 红方必须走出同一步
  const a = createMatch("HONEST", { depth: 2, temperature: 0.4 });
  const b = createMatch("HONEST", { depth: 2, temperature: 0.4 });
  const board = b.state.board;
  const spots = [];
  for (let s = J.N / 2; s < J.N; s++) if (board[s] && board[s][0] === "b" && board[s][1] >= "2" && board[s][1] <= "9" && J.rowOf("b", J.rankOf(s)) >= 2 && J.rowOf("b", J.rankOf(s)) <= 4) spots.push(s);
  const [x, y] = [spots[0], spots.find((s) => board[s] !== board[spots[0]])];
  [board[x], board[y]] = [board[y], board[x]];
  ok(J.keyOf(a.state.board, "r") !== J.keyOf(b.state.board, "r"), "两盘的真实局面不同");
  const ca = finish(decide(a)), cb = finish(decide(b));
  ok(ca.move.from === cb.move.from && ca.move.to === cb.move.to, "红方的选择只取决于它看得见的东西", `${J.coord(ca.move.from)}→${J.coord(ca.move.to)}`);
}

console.log("红黑对称");
{
  // 把红方看到的局面旋转 180° 并换色，交给同样性格、同样随机数的黑方：必须走出镜像的一步
  const { think } = await import("../src/ai/brain.js");
  const flipSq = (s) => J.N - 1 - s;
  const swap = (c) => (c === "r" ? "b" : "r");
  const mirror = (v) => ({
    me: swap(v.me),
    board: v.board.map((_, s) => { const p = v.board[flipSq(s)]; return p ? swap(p[0]) + p[1] : null; }),
    masks: v.masks.map((_, s) => v.masks[flipSq(s)]),
    dead: v.dead.slice(),
    trail: v.trail.map((t) => ({ side: swap(t.side), from: flipSq(t.from), to: flipSq(t.to) })),
    quiet: v.quiet,
  });
  const m = createMatch("MIRROR", { depth: 2, temperature: 0.4 });
  let same = 0, checked = 0;
  while (!m.result.over && m.log.length < 60) {
    const side = m.state.side;
    const view = observe(m.state, m.know[side]);
    const a = finish(think(view, m.armies[side], makeRng("M" + m.log.length), m.settings));
    const z = finish(think(mirror(view), m.armies[side], makeRng("M" + m.log.length), m.settings));
    checked++;
    if (flipSq(a.move.from) === z.move.from && flipSq(a.move.to) === z.move.to) same++;
    commit(m, finish(decide(m)));
  }
  ok(same === checked, `${checked} 个局面：换色后的选择全部是原选择的镜像`, `${same}/${checked}`);
}

console.log("整盘对局");
const t0 = Date.now();
const a = runSync("SEED01", { depth: 2, temperature: 0.4 });
const msA = Date.now() - t0;
const a2 = runSync("SEED01", { depth: 2, temperature: 0.4 });
const b = runSync("ZX9Q2K", { depth: 2, temperature: 0.4 });
const line = (m) => m.log.map((e) => e.notation).join(" ");
const verdict = (m) => (m.result.winner ? (m.result.winner === "r" ? "红胜" : "黑胜") : "和");
ok(a.result.over, `SEED01 打完：${verdict(a)}（${a.result.reason}）`, `${a.log.length} 步 · ${msA} ms`);
ok(line(a) === line(a2), "同一种子复现同一盘棋");
ok(line(a) !== line(b), "不同种子是不同的棋");
ok(a.log.some((e) => /暗子/.test(e.text.r.notation)) && a.log.every((e) => !/暗子/.test(e.text.all.notation)), "暗棋：红方视角有认不出的敌子，全知视角没有");
{
  // 整盘棋里每一步之后：活着的敌子的真实兵种都在对方的信念里
  const m = createMatch("SOUND1", { depth: 2, temperature: 0.5 });
  let sound = true, named = 0;
  while (!m.result.over) {
    commit(m, finish(decide(m)));
    for (const v of ["r", "b"])
      for (let s = 0; s < J.N; s++) {
        const p = m.state.board[s], k = m.know[v];
        if (p && p[0] === k.enemy) {
          sound &&= !!(k.masks[s] & bit(p[1]));
          if (identified(k, s)) named++, (sound &&= identified(k, s) === p[1]);
        } else sound &&= !k.masks[s];
      }
  }
  ok(sound, "信念永远包含真相，认出的兵种从不出错", `${m.log.length} 步，累计认出 ${named} 次`);
}
{
  const o = runSync("OPEN01", { depth: 2, temperature: 0.4, mode: "open" });
  ok(o.result.over && o.log.every((e) => e.text.r.notation === e.text.all.notation && e.text.b.comment === e.text.all.comment), `明棋：三种观众看到的完全一样（${verdict(o)}，${o.log.length} 步）`);
}
console.log("   SEED01:", a.armies.r.persona.name, a.armies.r.formation.name, "/", a.armies.b.persona.name, a.armies.b.formation.name);
console.log("   解说示例:", a.log.map((e) => e.text.all.comment).filter((c) => /！|铁路|行营/.test(c)).slice(0, 6).join(" | "));

console.log("入座点兵");
{
  const seat = { side: "b", formation: "空城计", mirror: true };
  const plain = createMatch("SEAT01", { depth: 2 });
  const seated = createMatch("SEAT01", { depth: 2, seat });
  const want = arrange("空城计", true).layout;
  const got = want.map((_, i) => seated.state.board[J.ownSq("b", J.fileOf(i), J.rankOf(i))]);
  ok(got.every((p, i) => (want[i] ? p === "b" + want[i] : p === null)), "入座一方摆出的就是他点的阵，原样、不加随机变化");
  const reds = (m) => m.state.board.slice(0, J.N / 2).join();
  ok(reds(plain) === reds(seated), "换阵型不改变对手：电脑那一方仍由种子决定");
  ok(seated.script.settings.seat.formation === "空城计", "入座信息记进对局脚本");
  // 人执黑下几步，再凭脚本重放：布阵和每一步都要对得上
  const drive = (m) => {
    while (!m.result.over && m.log.length < 30) {
      const { scripted } = startTurn(m, { temperature: m.settings.temperature, depth: m.settings.depth });
      if (scripted) commit(m, scripted);
      else if (m.state.side === "b" && !m.replay) commit(m, { move: J.legalMoves(m.state.board, "b")[m.log.length % 3], kind: "human" });
      else commit(m, finish(decide(m)));
    }
    return m;
  };
  const first = drive(seated);
  const again = drive(createMatch("SEAT01", { depth: 3, temperature: 0.9 }, first.script));
  ok(first.log.map((e) => e.notation).join() === again.log.map((e) => e.notation).join() && J.keyOf(first.state.board, "r") === J.keyOf(again.state.board, "r"), "重放连人的布阵一起复现", `${first.log.length} 步`);
  ok(LEVELS.length === 3 && LEVELS.every((l) => l.name && l.depth >= 1 && l.temperature >= 0 && l.temperature <= 1), "三档难度齐全");
}

console.log("精确重放（中途改设置 + 人类走子）");
{
  const play = (match, live, humanAt) => {
    while (!match.result.over && match.log.length < 50) {
      const ply = match.log.length;
      if (ply === 6) live = { temperature: 0.9, depth: 2 };
      if (ply === 15) live = { temperature: 0.1, depth: 3 };
      const { scripted } = startTurn(match, live);
      if (scripted) {
        commit(match, scripted);
        continue;
      }
      if (humanAt.includes(ply)) {
        commit(match, { move: J.legalMoves(match.state.board, match.state.side)[0], kind: "human" });
        continue;
      }
      commit(match, finish(decide(match)));
    }
    return match;
  };
  const original = play(createMatch("REPLAY", { temperature: 0.35, depth: 2 }), { temperature: 0.35, depth: 2 }, [3, 8, 11]);
  const again = play(createMatch("REPLAY", { temperature: 0.7, depth: 3 }, original.script), { temperature: 0.7, depth: 3 }, []);
  ok(line(original) === line(again), `重放与原局逐步一致（${original.log.length} 步，脚本 ${original.script.events.length} 条记录）`);
  // 一次思考被中途丢弃（用户接管又交还）：选步的随机流按步派生，后面的棋不能因此错位
  const steady = createMatch("ABORT1", { temperature: 0.5, depth: 2 });
  const jolted = createMatch("ABORT1", { temperature: 0.5, depth: 2 });
  for (let i = 0; i < 24 && !steady.result.over; i++) {
    commit(steady, finish(decide(steady)));
    if (i === 6 || i === 13) {
      const dropped = decide(jolted);
      for (let n = 0; n < 5; n++) dropped.next(); // 想到一半就扔掉
    }
    commit(jolted, finish(decide(jolted)));
  }
  ok(line(steady) === line(jolted), "思考被打断两次，整盘棋仍然一样");
  const naive = runSync("REPLAY", { temperature: 0.35, depth: 2 }, 50);
  ok(line(naive) !== line(original), "不带脚本直接重放种子会走出不同的棋（说明脚本确实起作用）");
}

console.log("单步耗时");
for (const depth of [2, 3]) {
  const m = createMatch("TIMING", { depth, temperature: 0.3 });
  let worst = 0, total = 0, n = 0;
  for (let i = 0; i < 30 && !m.result.over; i++) {
    const t = Date.now();
    const c = finish(decide(m));
    const ms = Date.now() - t;
    worst = Math.max(worst, ms);
    total += ms;
    n++;
    commit(m, c);
  }
  ok(worst < 4000, `深度 ${depth}，30 步：平均 ${Math.round(total / n)} ms，最慢 ${worst} ms（分片执行，不阻塞界面）`);
}

console.log(failed ? `\n${failed} 项失败` : "\nAI 全部通过");
process.exitCode = failed ? 1 : 0;
