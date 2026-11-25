Better Paseo Math is an independent fork of [Better Paseo by RoundRedDot](https://github.com/RoundRedDot/better-paseo), based on version 1.6.2. It keeps the Tasks board and compact chat timeline and adds LaTeX rendering to assistant replies.

Use inline formulas in prose or Markdown table cells, and display formulas on their own lines. Completed replies render formulas with MathJax. The timeline shows the original LaTeX while a reply streams or when a formula cannot be rendered. You can switch a rendered formula back to its source.

## Setup

Use Paseo 0.14.0 or later with Node.js 22 or later and npm on the daemon host. Keep the plugin's Markdown rendering enabled to see formulas. Enable one assistant-reply renderer at a time. If Better Paseo or Math Renderer Plus already handles your replies, disable it before enabling Better Paseo Math.

## Data access

Formula text goes to your connected Paseo daemon. Its bundled MathJax renderer renders the formulas locally without an external math service. The plugin uses displayed conversations, tool results, agent metadata and appearance settings for the timeline and Tasks board. Syntax highlighting and file previews can use the daemon, and desktop actions can open or reveal files.

Optional model-generated task titles send conversation excerpts and the configured prompt to a helper agent through the selected provider. The plugin stores recent turn timing, token usage and errors on the daemon, and can read provider session files for token counts. It can query npm for provider CLI version information. Some board actions use the Paseo CLI or a local daemon connection.
