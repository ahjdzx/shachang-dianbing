/**
 * [INPUT]: 依赖 engine/junqi 的 parseLayout、mirrorLayout、layoutError、HQ
 * [OUTPUT]: FORMATIONS（阵型名 → 一句说明 + 六行模板）、arrange（原样布阵，可镜像）、deploy（电脑按种子布阵）
 * [POS]: ai 的阵型库，相当于象棋的开局库。只产出布阵，不参与对局中的决策；合规与否由引擎的 layoutError 说了算。
 *        人和电脑从同一个库里取阵：人用 arrange 原样摆，电脑用 deploy 在上面加随机变化。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { parseLayout, mirrorLayout, layoutError, HQ } from "../engine/junqi.js";

// 六行，底线在上、第一排在下；「.」是行营。兵种：9 司令 … 1 工兵，B 炸弹，M 地雷，F 军旗。
// note 是给人看的一句话：人入座点兵时照着它挑。
export const FORMATIONS = {
  三角雷: { note: "三颗雷围住军旗，稳守反击", rows: ["MFM22", "1M131", "5.B.4", "6B.37", "4.9.5", "73286"] },
  铁路快攻: { note: "大子压在两条边线，抢先手", rows: ["32MFM", "141M1", "8.2.6", "5B.B5", "7.3.4", "93627"] },
  中路突破: { note: "司令军长居中，炸弹垫后", rows: ["23MFM", "151M4", "6.B.6", "37.72", "5.8.B", "42931"] },
  空城计: { note: "雷区摆在假旗一侧，真旗靠炸弹看门", rows: ["3F2MM", "4B1M1", "6.5.2", "7B.39", "4.3.5", "82716"] },
};

// 原样摆出一套阵型，只可选左右镜像。人点兵用它：选的是什么，摆出来就是什么。
export function arrange(name, mirror = false) {
  const layout = parseLayout(FORMATIONS[name].rows);
  return { name, layout: mirror ? mirrorLayout(layout) : layout };
}

// 电脑布阵：原样阵型 → 随机左右镜像 → 随机对调几对军官。地雷、炸弹、军旗不动，阵型的骨架不变。
// 大本营里的那个子也不参与对调：进了大本营就不能动，模板特意在那里放小子，不能把司令换进去。
export function deploy(rng, name) {
  const { layout } = arrange(name, rng.chance(0.5));
  const officers = layout.map((t, i) => (t >= "1" && t <= "9" && !HQ[i] ? i : -1)).filter((i) => i >= 0);
  for (let n = 0; n < 3; n++) {
    const a = rng.pick(officers), b = rng.pick(officers);
    [layout[a], layout[b]] = [layout[b], layout[a]];
    if (layoutError(layout)) [layout[a], layout[b]] = [layout[b], layout[a]];
  }
  return { name, layout };
}
