/**
 * [INPUT]: 不引用本项目的其他模块。阵型和难度的清单由调用方传入；用 localStorage 记住上次的选择
 * [OUTPUT]: createSeating(root, { formations, levels, onChange, onStart, onCancel }) → { seat, sync }
 * [POS]: ui 的开局牌，人入座「点兵」时摆在桌边。它只收集三个选择——执子、阵型、对手——并把变化告诉总控；
 *        棋子怎么走位、对局怎么开始，都不归它管。样式在 style.css 的 .seat 一节。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

const KEY = "shachang-dianbing.seat";

// 上次的选择只在仍然有效时才沿用：阵型库或档位改过名，就退回默认
function recall(valid) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    const out = {};
    for (const k in valid) if (valid[k](saved[k])) out[k] = saved[k];
    return out;
  } catch {
    return {};
  }
}
function remember(seat) {
  try {
    localStorage.setItem(KEY, JSON.stringify(seat));
  } catch {
    // 无痕模式或存储已满：不记就是了，不影响下棋
  }
}

export function createSeating(root, { formations, levels, onChange, onStart, onCancel }) {
  const seat = {
    side: "r",
    formation: formations[0].name,
    mirror: false,
    level: levels[Math.min(1, levels.length - 1)].key,
    ...recall({
      side: (v) => v === "r" || v === "b",
      formation: (v) => formations.some((f) => f.name === v),
      mirror: (v) => typeof v === "boolean",
      level: (v) => levels.some((l) => l.key === v),
    }),
  };
  const chip = (group, value, text) => `<label><input type="radio" name="seat-${group}" value="${value}" /><span>${text}</span></label>`;
  root.innerHTML = `
    <header><h2>点兵</h2><p>排好阵，挑个对手，就开战！</p></header>
    <fieldset class="pick sides"><legend>你当哪一方</legend>
      ${chip("side", "r", "红军")}${chip("side", "b", "黑军")}
    </fieldset>
    <fieldset class="pick formations"><legend>棋子怎么摆<label class="check"><input type="checkbox" name="seat-mirror" />左右换一换</label></legend>
      ${formations.map((f) => chip("formation", f.name, f.name)).join("")}
      <p class="note" data-note="formation" aria-live="polite"></p>
    </fieldset>
    <fieldset class="pick levels"><legend>对手有多厉害</legend>
      ${levels.map((l) => chip("level", l.key, l.name)).join("")}
      <p class="note" data-note="level" aria-live="polite"></p>
    </fieldset>
    <div class="row actions"><button class="primary" data-act="start">开战！</button><button class="ghost" data-act="cancel">先不下</button></div>`;

  // 把当前选择写回控件，并更新两句说明
  function sync() {
    for (const group of ["side", "formation", "level"]) for (const el of root.querySelectorAll(`[name="seat-${group}"]`)) el.checked = el.value === seat[group];
    root.querySelector('[name="seat-mirror"]').checked = seat.mirror;
    root.querySelector('[data-note="formation"]').textContent = formations.find((f) => f.name === seat.formation).note;
    root.querySelector('[data-note="level"]').textContent = levels.find((l) => l.key === seat.level).note;
  }
  root.addEventListener("change", (e) => {
    const what = e.target.name.replace("seat-", "");
    seat[what] = what === "mirror" ? e.target.checked : e.target.value;
    sync();
    remember(seat);
    onChange(what);
  });
  root.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    if (act === "start") onStart();
    else if (act === "cancel") onCancel();
  });
  sync();
  return { seat, sync };
}
