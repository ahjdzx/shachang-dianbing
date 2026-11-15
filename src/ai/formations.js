/**
 * [INPUT]: 依赖 engine/junqi 的 parseLayout、mirrorLayout、layoutError、HQ
 * [OUTPUT]: FORMATIONS（阵型名 → 六行模板）、deploy（按种子生成一份合规布阵）
 * [POS]: ai 的阵型库，相当于象棋的开局库。只产出布阵，不参与对局中的决策；合规与否由引擎的 layoutError 说了算。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { parseLayout, mirrorLayout, layoutError, HQ } from "../engine/junqi.js";

// 六行，底线在上、第一排在下；「.」是行营。兵种：9 司令 … 1 工兵，B 炸弹，M 地雷，F 军旗。
export const FORMATIONS = {
  // 三颗雷把军旗围死，只有工兵和炸弹啃得动；司令压在第二排居中策应
  三角雷: ["MFM22", "1M131", "5.B.4", "6B.37", "4.9.5", "73286"],
  // 大子压在两条边线铁路上，开局就能长驱直入
  铁路快攻: ["32MFM", "141M1", "8.2.6", "5B.B5", "7.3.4", "93627"],
  // 司令、军长居中，炸弹垫后
  中路突破: ["23MFM", "151M4", "6.B.6", "37.72", "5.8.B", "42931"],
  // 雷区摆在假旗一侧，真旗只靠一颗炸弹看门；司令藏在第三排的边线铁路上
  空城计: ["3F2MM", "4B1M1", "6.5.2", "7B.39", "4.3.5", "82716"],
};

// 生成布阵：取模板 → 随机左右镜像 → 随机对调几对军官。地雷、炸弹、军旗不动，阵型的骨架不变。
// 大本营里的那个子也不参与对调：进了大本营就不能动，模板特意在那里放小子，不能把司令换进去。
export function deploy(rng, name) {
  let layout = parseLayout(FORMATIONS[name]);
  if (rng.chance(0.5)) layout = mirrorLayout(layout);
  const officers = layout.map((t, i) => (t >= "1" && t <= "9" && !HQ[i] ? i : -1)).filter((i) => i >= 0);
  for (let n = 0; n < 3; n++) {
    const a = rng.pick(officers), b = rng.pick(officers);
    [layout[a], layout[b]] = [layout[b], layout[a]];
    if (layoutError(layout)) [layout[a], layout[b]] = [layout[b], layout[a]];
  }
  return { name, layout };
}
