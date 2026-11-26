# Better Paseo Math

[简体中文](README-zh.md)

Better Paseo Math is an independent fork of [Better Paseo by RoundRedDot](https://github.com/RoundRedDot/better-paseo) 1.6.2. It keeps the Tasks board and compact chat timeline while adding MathJax LaTeX rendering, HTML `<br>` table line breaks, message edit/rewind and conversation forking, and a unified Sidechat panel.

- **LaTeX & Markdown tables**: Inline math (`$...$` and `\(...\)`) in prose and table cells, display math (`$$...$$`, `\[...\]`, fenced `math`), local daemon MathJax rendering with source toggle, and `<br>` / `<br/>` / `<br />` multi-line rendering inside Markdown tables with accurate per-line column widths.
- **Edit sent messages & overwrite turns**: Edit any sent prompt to resend and overwrite subsequent turns, or rewind it back into the composer. Uses Paseo's native `agent.rewind.request` (conversation / files / both) when supported by the provider, and automatically falls back to a same-workspace replacement branch with prior context (optionally archiving the superseded thread) on providers without native rewind.
- **Fork conversations from any node**: Create a duplicate conversation from any user message or assistant reply, via Command Center, or with `/fork`, preserving history up to that exact node with a collapsible origin card and immediate tab focus.
- **Unified Sidechat**: Full multi-provider Sidechat adapted from [Norman-else/paseo-better-sidechat](https://github.com/Norman-else/paseo-better-sidechat) (`284f9e00`), styled with Better Paseo Math's theme tokens, fonts, `MarkdownView` + MathJax renderer, tool/reasoning/todo/notice cards, and a unified **Sidechat** settings tab.

![Inline, table-cell, and display formulas in a sample conversation](assets/marketplace/formula-rendering.png)

## Installation

The daemon host needs Paseo 0.14.0 or later (0.16.0+ for Sidechat panels and composer integration), Node.js 22 or later, and npm. To install release `v1.1.1` directly from GitHub:

```sh
paseo plugin add git:EviterLesRoses2/better-paseo-math --ref v1.1.1
```

Keep the plugin's Markdown rendering enabled. Disable Better Paseo, Math Renderer Plus, or standalone Better Sidechat before enabling this plugin to avoid conflicting reply renderers or duplicate `/btw` commands.

See [the listing overview](OVERVIEW.md) for setup, data access, and limitations. The original [Better Paseo 1.6.2 documentation](https://github.com/RoundRedDot/better-paseo/tree/0168adb5ba85512b2c41a17ae88481daab4de300) covers the timeline and Tasks board.

## Credits

The original Better Paseo code and design are by [RoundRedDot and its contributors](https://github.com/RoundRedDot/better-paseo/graphs/contributors). This fork preserves the [MIT license](LICENSE). The formula renderer builds on [Math Renderer Plus](https://github.com/EviterLesRoses2/paseo-math-renderer-plus). Sidechat is adapted from [Better Sidechat by Norman-else](https://github.com/Norman-else/paseo-better-sidechat). See [formula renderer provenance](third-party/math/README.md) for dependency and font notices.
