# 沙场点兵 - 会自己下完一整盘军棋（陆战棋）的 3D 桌面对战
three 0.186.1 + vite 8.3.5 + 原生 ES 模块（无框架、无构建期代码生成）+ Node 26 直接跑测试

<directory>
src/engine/ - 裁判：军棋规则、棋盘拓扑、布阵约束、对局记录。纯逻辑，掌握全部真相
src/ai/ - 棋手：种子随机数、暗棋信念、阵型库、估值、推演、决策、解说
src/game/ - 一盘棋：串起裁判与棋手。commit() 是唯一能改变对局状态的入口
src/sim/ - 演出：把已判定的一步棋演出来（协程、刚体、特效）
src/render/ - 画面：桌子与棋盘、十二个兵种的人偶、自动导播
src/ui/ - 覆盖在画布上的界面样式
src/main.js - 总控：回合流程，决定观众是谁（全知 / 红方 / 黑方）
test/ - 规则关卡、AI 关卡、对局场
</directory>

<config>
package.json - 脚本：dev、build、preview、test、bench
vite.config.js - 资源走相对路径，根路径和子路径都能部署
index.html - 页面骨架：画布、左侧设置、右侧棋谱与兵力表、解说条
.github/workflows/deploy.yml - 推送 main 后：跑测试 → 构建 → 发布到 GitHub Pages
PRODUCT.md - 产品事实：给谁用、做什么、定位、必须守住的约束、没定下来的事。做产品取舍前先读它
.impeccable/config.json - 设计工具的工作方式设置（新界面直接写代码，不先出效果图）
</config>

<law>
依赖严格单向：engine ← ai ← game ← main；engine ← render ← sim ← main。render、sim 不引用 ai、game。
暗棋边界：电脑（ai/brain）只拿 ai/knowledge 的 observe() 视图，读不到敌方兵种。画面层持有真实棋子，由 main 按 game/match 的 visible() 给没认出的敌子蒙布；文字、胜率按观众各出一份。
演出不改对局：sim、render 只读走法记录。胜负永远由 engine 判定。
随机可复现：布阵、抽样、选步只从 ai/rng 的种子流取数。同一种子加同一份对局脚本，复现同一盘棋。
</law>

[PROTOCOL]: Update this header on change, then check CLAUDE.md
