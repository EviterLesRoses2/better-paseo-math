# Better Paseo Math

[English](README.md)

Better Paseo Math 是基于 [RoundRedDot 的 Better Paseo](https://github.com/RoundRedDot/better-paseo) 1.6.2 开发的独立分支。它保留任务看板与紧凑聊天时间线，并集成 LaTeX 公式渲染、表格 `<br>` 换行渲染、已发送消息重新编辑覆盖、对话分叉，以及统一 UI 风格的侧边对话（Sidechat）。

- **LaTeX 公式与表格换行**：正文和表格单元格支持 `$...$` 与 `\(...\)` 行内公式，支持 `$$...$$`、`\[...\]` 及 `math` 代码块独立公式；由本地 Paseo 守护进程内置 MathJax 渲染并可切回源码；支持 Markdown 表格及行内的 `<br>` / `<br/>` / `<br />` 多行渲染与按最长行计算的列宽。
- **重新编辑已发送消息并覆盖后续**。可在命令中心选择「重新编辑上一条消息」，覆盖重发或将上一条提问放回输入框。服务商支持原生回退时使用 Paseo 原生功能。其他服务商会在同一工作区创建保留前文的替代分支，可归档原对话。
- **创建对话副本**。可从助手回复、命令中心或通过 `/fork` 创建对话副本，并保留截至分叉点的历史。
- **统一风格的侧边对话（Sidechat）**：完整集成改编自 [Norman-else/paseo-better-sidechat](https://github.com/Norman-else/paseo-better-sidechat)（`284f9e00`）的多服务商侧边对话能力，全面统一采用 Better Paseo Math 的主题 Token、字体、`MarkdownView` + MathJax 公式渲染、工具/思考/待办/通知卡片以及设置页「侧边对话」标签页。

![示例对话中的行内公式、表格内公式和独立公式](assets/marketplace/formula-rendering.png)

含附件或附件信息不完整的主聊天提问使用 Paseo 原生气泡，保留 Paseo 可显示的图片预览。Paseo 确认提问没有附件时，增强气泡会显示该提问的编辑和分叉按钮。

## 安装

守护进程所在机器需要 Paseo 0.14.0 或更高版本（侧边对话面板与输入栏集成需 0.16.0+）、Node.js 22 或更高版本及 npm。可从 GitHub 安装 `v1.1.3`：

```sh
paseo plugin add git:EviterLesRoses2/better-paseo-math --ref v1.1.3
```

请保持插件的 Markdown 渲染开启。启用本插件前，请先停用原版 Better Paseo、Math Renderer Plus 以及独立的 Better Sidechat，以避免助手回复渲染器或 `/btw` 命令冲突。

[市场简介](OVERVIEW.zh-CN.md)说明了使用条件、数据访问和限制。任务看板与时间线的用法见[原版 Better Paseo 1.6.2 文档](https://github.com/RoundRedDot/better-paseo/tree/0168adb5ba85512b2c41a17ae88481daab4de300)。

## 致谢

原版 Better Paseo 由 [RoundRedDot 及贡献者](https://github.com/RoundRedDot/better-paseo/graphs/contributors)开发，本分支保留其 [MIT 许可](LICENSE)。公式渲染基于 [Math Renderer Plus](https://github.com/EviterLesRoses2/paseo-math-renderer-plus)。侧边对话功能改编自 [Norman-else 的 Better Sidechat](https://github.com/Norman-else/paseo-better-sidechat)。第三方依赖及字体许可见[来源说明](third-party/math/README.md)。
