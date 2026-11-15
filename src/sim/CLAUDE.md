# sim/
> L2 | Parent: ../../CLAUDE.md

演出层。它把引擎已经判定的一步棋演出来。胜负在记录里，这里只决定怎么演。
依赖方向：sim → render → engine。sim 不引用 ai、game；它读走法记录，从不写回对局。

## 成员清单

show.js: 导演台 Stage，演出层对外的唯一入口。每一步是一个生成器协程，update(dt) 推进，dt 为 0 时全场静止。它沿记录里的 path 走子：铁路滑行，公路迈步，工兵的拐角抹圆。交战按 result 分五种演法；爆炸、踩雷、挖雷会暴露兵种，只在相应棋子没蒙布时才演，蒙着布就演通用动作。炸弹坐木橇滑行也一样：蒙着布时按普通棋子迈步。
physics.js: 轻量刚体，只给阵亡的棋子用。它用点采样加冲量法让木块倒地、弹跳、静止。站着的棋子在它眼里是不动的圆柱，被撞到只晃一下。
fx.js: 特效 Effects：扬尘、黑烟、火球、花瓣、闪光、冲击环。粒子用 Math.random，不占用对局的种子随机流。

## 约定

- 演出里影响观感走向的随机（打飞的力度、进托盘还是化花瓣）用 Stage 的种子随机数 rng；纯粒子抖动用 Math.random。
- 阵亡的棋子保持蒙布状态倒地、进托盘。暗棋不揭示死子。
- Stage 发出的事件：move-start、move-end、knock、blast、dig、flag。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
