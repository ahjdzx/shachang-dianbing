# ui/
> L2 | Parent: ../../CLAUDE.md

界面样式。只管覆盖在画布上的 DOM 外观，不含逻辑。元素结构在 /index.html，行为在 /src/main.js。

## 成员清单

style.css: 左侧设置面板、右侧棋谱与兵力表、顶部胜率条、底部解说条、终局横幅。配色沿用漆木桌的暖色：金色强调，红方暖红，黑方灰蓝。屏宽不超过 700px 时换成手机布局：设置收成顶部一条（标题、战况、设置、暂停），棋谱与兵力表变成「战况」底部抽屉，按钮加高到好点，四周让出安全区。

## 约定

- 窄屏的判断只有一个断点：700px。样式里用媒体查询，main.js 里用同一个 matchMedia 决定设置面板默认收起。
- `.narrow-only` 的元素只在窄屏显示。

[PROTOCOL]: Update this header on change, then check CLAUDE.md
