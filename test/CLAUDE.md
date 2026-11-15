# test/
> L2 | Parent: ../CLAUDE.md

测试。全部用 Node 直接运行，不需要浏览器，不依赖测试框架。只覆盖 engine、ai、game 三层纯逻辑；画面在浏览器里人工或用 playwright-cli 验证。

## 成员清单

engine.test.mjs: 规则关卡。棋盘拓扑定数、perft 34 / 1159 / 36185、布阵规则、每类走法、战斗表、记录与撤销、三种终局。
ai.test.mjs: AI 关卡。守三条线：信念永远包含真相；真相不同而视图相同时电脑走出同一步；同一种子连同脚本精确复现。另有阵型合规、推演找得到夺旗和解围、单步耗时。
arena.mjs: 对局场。批量跑整盘棋，报告胜负和比例、步数、耗时、信念是否出错。调 AI 时用它看全貌，不是断言测试。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
