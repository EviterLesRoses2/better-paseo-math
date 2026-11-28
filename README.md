# Better Paseo Math

[简体中文](README-zh.md)

Better Paseo Math is an independent fork of [Better Paseo by RoundRedDot](https://github.com/RoundRedDot/better-paseo) 1.6.2. It keeps the Tasks board and compact chat timeline while adding MathJax LaTeX rendering, HTML `<br>` table line breaks, message edit/rewind and conversation forking, and a unified Sidechat panel.

- **LaTeX & Markdown tables**: Inline math (`$...$` and `\(...\)`) in prose and table cells, display math (`$$...$$`, `\[...\]`, fenced `math`), local daemon MathJax rendering with source toggle, and `<br>` / `<br/>` / `<br />` multi-line rendering inside Markdown tables with accurate per-line column widths.
- **Edit sent messages & overwrite turns**: Use **Edit last sent message** in the Command Center to resend the latest prompt or restore it to the composer. Uses Paseo's native rewind when supported by the provider. Other providers create a replacement branch in the same workspace with prior context and can archive the superseded chat.
- **Fork conversations**: Fork from an assistant reply, the Command Center, or `/fork`, preserving history up to the selected point.
- **Unified Sidechat**: Full multi-provider Sidechat adapted from [Norman-else/paseo-better-sidechat](https://github.com/Norman-else/paseo-better-sidechat) (`284f9e00`), styled with Better Paseo Math's theme tokens, fonts, `MarkdownView` + MathJax renderer, tool/reasoning/todo/notice cards, and a unified **Sidechat** settings tab.

![Inline, table-cell, and display formulas in a sample conversation](assets/marketplace/formula-rendering.png)

Main-chat prompts with attachments or incomplete attachment information use Paseo's own bubble. This preserves Paseo's available image previews. The plugin adds per-prompt edit and fork buttons when the timeline confirms the prompt has no attachments and the enhanced bubble is enabled.

## Installation

The daemon host needs Paseo 0.14.0 or later (0.16.0+ for Sidechat panels and composer integration), Node.js 22 or later, and npm. To install release `v1.1.3` directly from GitHub:

```sh
paseo plugin add git:EviterLesRoses2/better-paseo-math --ref v1.1.3
```

Keep the plugin's Markdown rendering enabled. Disable Better Paseo, Math Renderer Plus, or standalone Better Sidechat before enabling this plugin to avoid conflicting reply renderers or duplicate `/btw` commands.

See [the listing overview](OVERVIEW.md) for setup, data access, and limitations. The original [Better Paseo 1.6.2 documentation](https://github.com/RoundRedDot/better-paseo/tree/0168adb5ba85512b2c41a17ae88481daab4de300) covers the timeline and Tasks board.

## Credits

The original Better Paseo code and design are by [RoundRedDot and its contributors](https://github.com/RoundRedDot/better-paseo/graphs/contributors). This fork preserves the [MIT license](LICENSE). The formula renderer builds on [Math Renderer Plus](https://github.com/EviterLesRoses2/paseo-math-renderer-plus). Sidechat is adapted from [Better Sidechat by Norman-else](https://github.com/Norman-else/paseo-better-sidechat). See [formula renderer provenance](third-party/math/README.md) for dependency and font notices.
