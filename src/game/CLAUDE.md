# game/
> L2 | Parent: ../../CLAUDE.md

对局层。它把裁判（engine）和棋手（ai）串成一盘棋。仍然是纯逻辑。
依赖方向：game → ai → engine。

## 成员清单

match.js: 一盘对局的全部状态和唯一的落子入口 commit()。commit 只接受合法走法；它让双方各自从这一步学习，再为全知、红方、黑方三种观众各备一份文字和胜率。decide() 只把本方视图交给电脑。它记录「对局脚本」（初始设置、中途的设置改动、人类走子），传回 createMatch 就能精确重放。visible() 回答某位观众能否看出某格棋子的兵种。

## 约定

- mode（暗棋 / 明棋）一盘之内不变；temperature、depth 从下一回合生效并记进脚本。
- 明棋不是另一条代码路径：它只是信念一开始就全部确定。
- 选步的随机流按步派生（种子 + 第几步）。一次思考被中途丢弃不影响后面的步，重放因此对得上。
- 同一步只留一条设置记录，后改的覆盖先改的。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
