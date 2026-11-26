Better Paseo Math is an independent fork of [Better Paseo by RoundRedDot](https://github.com/RoundRedDot/better-paseo), based on version 1.6.2. It keeps the Tasks board and compact chat timeline, adds MathJax LaTeX rendering and HTML `<br>` line breaks in Markdown tables and inline prose, adds message editing/rewind and conversation forking from any node, and integrates a unified Sidechat panel.

Use inline formulas in prose or Markdown table cells, display formulas on their own lines, and `<br>` tags for multi-line table cells. Completed replies render formulas locally with MathJax. While a reply streams or when a formula cannot be rendered, the timeline shows the original LaTeX, and rendered formulas can switch back to source.

From any user message, you can edit and resend to overwrite subsequent turns or restore the message to the composer. Providers with native rewind support roll back in place (and optionally rewind files); other providers create a replacement branch from before that message in the same workspace and can archive the superseded conversation. From any user or assistant message, from the Command Center, or with `/fork`, you can create a forked conversation copy carrying history up to that node.

Sidechat opens a parallel conversation alongside a main agent or workspace, sharing Better Paseo Math's theme, fonts, Markdown and MathJax rendering, and timeline cards. Open it from the composer pill, the Command Center, or with `/btw` and `/sidechat`. Configure Sidechat defaults under the **Sidechat** tab in plugin settings. Sidechat is adapted from [Better Sidechat by Norman-else](https://github.com/Norman-else/paseo-better-sidechat/tree/284f9e00).

## Setup

Use Paseo 0.14.0 or later (Paseo 0.16.0 or later for Sidechat panels and composer integration) with Node.js 22 or later and npm on the daemon host. Keep the plugin's Markdown rendering enabled to see formulas. Enable one assistant-reply renderer at a time: disable Better Paseo or Math Renderer Plus before enabling Better Paseo Math, and disable standalone Better Sidechat to avoid duplicate `/btw` commands and side panels.

## Data access

Formula text goes to your connected Paseo daemon, where bundled MathJax renders formulas locally without an external math service. The plugin reads displayed conversations, tool results, agent metadata, and appearance settings for the timeline, Tasks board, and Sidechat. Syntax highlighting and file previews run on the daemon, and desktop actions can open or reveal files.

Conversation edit/rewind, forking, and Sidechat attachments, workspace file suggestions, slash commands, and external timeline plugin discovery use a local connection to your Paseo daemon or the Paseo CLI. When Sidechat attaches main-session context or a quoted selection, that excerpt is sent to the provider and model you select for Sidechat. Optional AI starter suggestions and model-generated task titles send conversation excerpts to a helper agent through the selected provider (AI starter suggestions run in an isolated temporary directory). The plugin stores Sidechat thread metadata, recent turn timing, token usage, and errors in its daemon plugin-data directory, migrates existing standalone Sidechat thread lists on first read, can read provider session files for token counts, and can query npm for provider CLI version information.
