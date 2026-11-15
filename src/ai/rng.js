/**
 * [INPUT]: 无依赖
 * [OUTPUT]: hashSeed、makeRng（带 int/pick/chance/fork 的种子随机数流）、freshSeed
 * [POS]: ai 的随机源。布阵、抽样、选步只从 makeRng 的流里取数，所以同一种子复现同一盘棋。演出层的特效自己用 Math.random，不影响对局。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
// 带种子的伪随机数：同一个种子总是产生同一串数。
// 种子是 6 位 36 进制字符串，方便显示和复制。

export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  // 派生一个独立的子流（例如给动画用），不影响主流
  next.fork = (tag) => makeRng(hashSeed(String(seed) + "/" + tag));
  return next;
}

export function freshSeed() {
  const n = Math.floor(Math.random() * 36 ** 6);
  return n.toString(36).padStart(6, "0").toUpperCase();
}
