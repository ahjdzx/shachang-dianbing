/**
 * [INPUT]: 依赖 engine/junqi 的 createGame、setupBoard、play、outcome、legalMoves；依赖 ai/rng 的 makeRng；
 *          依赖 ai/knowledge 的 createKnowledge、learn、observe、identified；依赖 ai/brain 的 createArmy、think、winRate、fogRate；
 *          依赖 ai/commentary 的 describe、endComment
 * [OUTPUT]: createMatch、startTurn、branch、decide、commit、visible、runSync、DEFAULTS、LEVELS（三档难度）
 * [POS]: game 的唯一成员，把裁判（engine）和棋手（ai）串成一盘棋。commit() 是全项目唯一能改变对局状态的入口，只接受合法走法。
 *        它也是暗棋的守门人：电脑只拿得到 observe() 的视图；每步棋为全知、红方、黑方三种观众各备一份文字和胜率。
 *        选步的随机流按步派生，所以思考可以被丢弃重来而不破坏重放。仍然是纯逻辑，可在 Node 里无界面地跑完整盘。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { RED, BLACK, createGame, setupBoard, play, outcome, legalMoves } from "../engine/junqi.js";
import { makeRng } from "../ai/rng.js";
import { createKnowledge, learn, observe, identified } from "../ai/knowledge.js";
import { createArmy, think, winRate, fogRate } from "../ai/brain.js";
import { arrange } from "../ai/formations.js";
import { describe, endComment } from "../ai/commentary.js";

// mode：dark 暗棋（互相看不见兵种）/ open 明棋。一盘之内不变；temperature、depth 可以中途改。
// seat：有人入座时是 { side, formation, mirror }——这一方用他亲手点的阵，原样摆出，不加随机变化。
export const DEFAULTS = { temperature: 0.35, depth: 2, mode: "dark", seat: null };

// 三档对手。档位只是温度和推演深度的预设；对手的性格和阵型仍由种子决定，并且对人保密。
export const LEVELS = [
  { key: "easy", name: "新手", note: "常走随手棋", temperature: 0.8, depth: 2 },
  { key: "mid", name: "熟手", note: "正常发挥", temperature: 0.35, depth: 2 },
  { key: "hard", name: "高手", note: "多想一步，少犯错", temperature: 0.1, depth: 3 },
];

// script：上一盘的「对局脚本」（初始设置 + 按步记录的设置改动和人类走子）。传入它就能精确重放。
export function createMatch(seed, settings = {}, script = null) {
  const root = makeRng(seed);
  const initial = { ...DEFAULTS, ...(script ? script.settings : settings) };
  const armies = { r: createArmy(root.fork("army-r"), RED), b: createArmy(root.fork("army-b"), BLACK) };
  // 入座的一方换成自己点的阵。电脑那一方照旧从种子来，所以换阵型不会改变对手
  if (initial.seat) armies[initial.seat.side].formation = arrange(initial.seat.formation, initial.seat.mirror);
  const state = createGame(setupBoard(armies.r.formation.layout, armies.b.formation.layout));
  const open = initial.mode === "open";
  return {
    seed,
    settings: { ...initial },
    state,
    armies,
    know: { r: createKnowledge(RED, state.board, open), b: createKnowledge(BLACK, state.board, open) },
    gauge: root.fork("gauge"), // 暗棋视角的胜率要抽样，单独一条流，不扰动选步
    log: [],
    result: { over: false },
    script: { seed, settings: { ...initial }, events: [] },
    replay: script ? script.events.slice() : null,
  };
}

const sameSettings = (a, b) => a.temperature === b.temperature && a.depth === b.depth;
// 同一步只留一条设置记录：一个回合可能被重开（中途接管），后改的覆盖先改的
function noteSettings(script, ev) {
  script.events = script.events.filter((e) => !(e.type === "settings" && e.ply === ev.ply));
  script.events.push(ev);
}

// 回合开始：重放时按脚本设定；否则采用界面上的当前设置，有变化就记进脚本
export function startTurn(match, live) {
  const ply = match.log.length;
  if (match.replay) {
    const ev = match.replay.find((e) => e.ply === ply && e.type === "settings");
    if (ev) {
      match.settings = { ...match.settings, temperature: ev.temperature, depth: ev.depth };
      noteSettings(match.script, { ...ev });
    }
    const human = match.replay.find((e) => e.ply === ply && e.type === "human");
    if (!match.replay.some((e) => e.ply > ply || (e.ply === ply && e.type === "human"))) match.replay = null; // 脚本走完
    if (human) {
      const move = legalMoves(match.state.board, match.state.side).find((m) => m.from === human.from && m.to === human.to);
      if (move) return { scripted: { move, kind: "human", replayed: true } };
    }
    return { scripted: null };
  }
  if (live && !sameSettings(live, match.settings)) {
    match.settings = { ...match.settings, temperature: live.temperature, depth: live.depth };
    noteSettings(match.script, { ply, type: "settings", temperature: live.temperature, depth: live.depth });
  }
  return { scripted: null };
}

// 重放途中用户改了东西：从这里起不再跟随脚本
export function branch(match) {
  match.replay = null;
}

// 生成器：电脑思考（可分片推进），返回选择。电脑拿到的只有本方的视图，看不到对方兵种。
// 随机流按步派生：一次思考被中途丢弃（用户接管又交还）不会让后面的步错位，重放才对得上。
export function* decide(match) {
  const side = match.state.side;
  const rng = makeRng(match.seed).fork("choice-" + match.log.length);
  return yield* think(observe(match.state, match.know[side]), match.armies[side], rng, match.settings);
}

// 观众 viewer（"all" 全知 | "r" | "b"）此刻能否看出 s 格棋子的兵种。终局后全部亮开。
export function visible(match, viewer, s) {
  const p = match.state.board[s];
  return viewer === "all" || match.result.over || !p || p[0] === viewer || identified(match.know[viewer], s) !== null;
}

// 落子：唯一会改变对局状态的入口，并且只接受合法走法
export function commit(match, choice) {
  const { state, know } = match;
  const m = legalMoves(state.board, state.side).find((l) => l.from === choice.move.from && l.to === choice.move.to);
  if (!m) throw new Error("非法走法被拒绝：" + JSON.stringify(choice.move));
  const entry = play(state, m);
  match.result = outcome(state);
  const over = match.result.over;

  // 双方各自从这一步的公开事实里学习，然后为三种观众各写一份文字
  const text = { all: describe(entry) };
  for (const v of [RED, BLACK]) {
    const known = learn(know[v], entry);
    const mine = entry.side === v;
    text[v] = describe(entry, { piece: mine || known, target: !mine || known });
  }
  const final = match.result.winner === RED ? 1 : match.result.winner === BLACK ? 0 : 0.5;
  const win = over ? { all: final, r: final, b: final } : { all: winRate(state.board), r: fogRate(observe(state, know.r), match.gauge), b: fogRate(observe(state, know.b), match.gauge) };
  // 军旗告急：走完这步，这一方下一手就能夺旗
  const threat = over ? null : legalMoves(state.board, entry.side).find((x) => x.result === "flag");

  if (choice.kind === "human") match.script.events.push({ ply: match.log.length, type: "human", from: m.from, to: m.to });
  const record = { ...entry, kind: choice.kind, replayed: !!choice.replayed, text, win, alarm: threat ? threat.to : -1, end: over ? endComment(match.result) : "" };
  match.log.push(record);
  return record;
}

export function runSync(seed, settings, maxPlies = 600) {
  const match = createMatch(seed, settings);
  while (!match.result.over && match.log.length < maxPlies) {
    const it = decide(match);
    let r = it.next();
    while (!r.done) r = it.next();
    commit(match, r.value);
  }
  return match;
}
