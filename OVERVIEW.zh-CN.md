Better Paseo Math 是基于 [RoundRedDot 的 Better Paseo](https://github.com/RoundRedDot/better-paseo) 1.6.2 开发的独立分支。它保留原版的任务看板和紧凑聊天时间线，并为助手回复增加 LaTeX 公式渲染。

支持正文和 Markdown 表格内的行内公式，以及单独成行的独立公式。回复完成后由 MathJax 渲染。回复仍在生成时，或遇到无法渲染的公式时，时间线会显示 LaTeX 源码。已经渲染的公式也可以切回源码。

## 使用条件

需要 Paseo 0.14.0 或更高版本，且守护进程所在机器需要 Node.js 22 或更高版本及 npm。请启用插件的 Markdown 渲染，并同时只启用一个助手回复渲染插件。如果正在使用 Better Paseo 或 Math Renderer Plus 渲染回复，请先停用它，再启用 Better Paseo Math。

## 数据访问

公式文本会发送给已连接的 Paseo 守护进程，由内置 MathJax 在该机器上渲染，无需外部公式服务。时间线和任务看板会使用当前显示的对话、工具结果、Agent 元数据和外观设置。语法高亮和文件预览可通过守护进程处理，桌面端支持打开文件或在文件管理器中定位文件。

启用模型生成任务标题后，对话片段和配置的提示词会经选定的模型服务商发送给辅助 Agent。插件会在守护进程端记录近期回合的耗时、Token 用量和错误，并可从服务商会话文件读取 Token 计数。插件可查询 npm 获取服务商 CLI 的版本信息。部分看板操作会调用 Paseo CLI 或使用本地守护进程连接。
