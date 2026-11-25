import { describe, expect, it } from "vitest";
import { lexBlock, lexBlockTokens } from "../../client/components/markdown/lex";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { repairTail } from "../../client/components/markdown/repair";
import type { InlineMathToken } from "../../client/components/markdown/inline-math-token";

function formulas(markdown: string, enabled = true): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "mathInline") {
      const token = value as InlineMathToken;
      found.push([token.text, token.raw]);
    }
    for (const field of ["tokens", "items", "header", "rows"]) if (Array.isArray(node[field])) visit(node[field]);
  }
  visit(lexBlock(markdown, false, enabled));
  return found;
}

describe("inline LaTeX in Better Paseo Markdown", () => {
  it.each([
    [String.raw`Use $x_i^2$ and \( a\ne b \).`, [["x_i^2", "$x_i^2$"], [String.raw`a\ne b`, String.raw`\( a\ne b \)`]]],
    ["# Heading $x$\n\n> quote **$b$**\n\n- list $z$", [["x", "$x$"], ["b", "$b$"], ["z", "$z$"]]],
    ["| Term | $f$ |\n| --- | --- |\n| One | $x_i$ |", [["f", "$f$"], ["x_i", "$x_i$"]]],
    [String.raw`Price $10 or $20. Escaped \$5. Then $x$.`, [["x", "$x$"]]],
    ["Costs $4, $6, and $8, then $K=2$.", [["K=2", "$K=2$"]]],
    ["`$x$` and ~~~ and $y$", [["y", "$y$"]]],
    ["~~~js\nconst v = '$x$';\n~~~\n\nRender $y$", [["y", "$y$"]]],
    [String.raw`Escaped \$x\$, also \\(fake\\), then $(x)$.`, [["(x)", "$(x)$"]]],
    ["Mid-paragraph $$x$$ followed by $y$.", [["y", "$y$"]]],
    ["$x$9, $ x $, and an unfinished $z", []],
    [String.raw`$\$x$ is TeX; [$a$](https://example.com) is linked.`, [[String.raw`\$x`, String.raw`$\$x$`], ["a", "$a$"]]],
  ])("recognizes math in %s", (markdown, expected) => {
    expect(formulas(markdown)).toEqual(expected);
  });

  it("keeps ordinary Markdown cached independently", () => {
    const source = String.raw`P $x$ and \(y\)`;
    expect(formulas(source, false)).toEqual([]);
    expect(formulas(source)).toHaveLength(2);
    expect(formulas(source, false)).toEqual([]);
  });

  it("keeps pipes inside table formulas out of the column count", () => {
    const table = [
      String.raw`| 维度 | 方案 1（$\max_t |\Delta P_i(t;\boldsymbol J)| \le \Delta P_i^{\mathrm{margin}}$） | 方案 2 |`,
      "|---|:---:|---:|",
      String.raw`| 数学形式 | \(\big|x\big|\) | $\frac{|x|}{y}$（上界） |`,
      "| 凸性 | **非凸** | 线性 |",
    ].join("\n");
    const message = `前文\n\n${table}\n\n后文`;
    const cache = createBlockCache();
    for (let length = 1; length <= message.length; length++) {
      expect(splitBlocks(message.slice(0, length), cache)).toEqual(splitBlocks(message.slice(0, length)));
    }
    expect(cache.blocks).toEqual(["前文\n\n", `${table}\n\n`, "后文"]);
    expect(lexBlockTokens(table)[0]).toMatchObject({ type: "table", raw: table });
    expect(lexBlock(table, false, true)[0]).toMatchObject({
      type: "table", raw: table, align: [null, "center", "right"],
      rows: [
        [{ text: "数学形式" }, { text: String.raw`\(\big|x\big|\)` }, { text: String.raw`$\frac{|x|}{y}$（上界）` }],
        [{ text: "凸性" }, { text: "**非凸**" }, { text: "线性" }],
      ],
    });
    expect(formulas(table).map(([tex]) => tex)).toEqual([
      String.raw`\max_t |\Delta P_i(t;\boldsymbol J)| \le \Delta P_i^{\mathrm{margin}}`,
      String.raw`\big|x\big|`, String.raw`\frac{|x|}{y}`,
    ]);
    const header = table.split("\n")[0]!;
    expect(lexBlock(repairTail(header), true, true)[0]).toMatchObject({
      type: "table", align: [null, null, null],
    });
  });

  it("preserves GFM escaped pipes, code spans and ordinary separators", () => {
    const table = [
      String.raw`| Left | Right |`, "|---|---|",
      String.raw`| \| | \(x|y\) |`,
      "| `$x\\|y$` | end |",
    ].join("\n");
    expect(lexBlock(table, false, true)[0]).toMatchObject({
      type: "table", raw: table,
      rows: [
        [{ text: "|" }, { text: String.raw`\(x|y\)` }],
        [{ text: "`$x|y$`", tokens: [{ type: "codespan" }] }, { text: "end" }],
      ],
    });
    expect(formulas(table)).toEqual([["x|y", String.raw`\(x|y\)`]]);
  });

  it.each([
    ["optional outer pipes", "Term | $|x|$\n--- | ---\nbound | $|y|$", ["|x|", "|y|"]],
    ["balanced TeX delimiters", String.raw`| Magnitude | Norm |
| --- | --- |
| $\left|z\right|$ | \(\left\lVert v\right\rVert\) |`, [String.raw`\left|z\right|`, String.raw`\left\lVert v\right\rVert`]],
    ["GFM-escaped formula pipes", String.raw`| Name | $\|x\|$ |
| --- | --- |
| abs | $\|y\|$ |`, ["|x|", "|y|"]],
    ["headings and nearby display formulas",
      "# Heading\n\n$$\na=b\n$$\n\n| a | $|c|$ |\n| --- | --- |\n| d | $|e|$ |\n\n$$\nx=y\n$$", ["|c|", "|e|"]],
    ["CRLF input", "| Name | $|x|$ |\r\n| --- | --- |\r\n| Body | $|y|$ |", ["|x|", "|y|"]],
    ["quoted table", "> | Name | $|x|$ |\n> | --- | --- |\n> | Body | $|y|$ |", ["|x|", "|y|"]],
    ["table nested in a list", "- Item\n\n  | Name | $|x|$ |\n  | --- | --- |\n  | Body | $|y|$ |", ["|x|", "|y|"]],
    ["money and unclosed formula", "| Expr | Amount |\n| --- | --- |\n| $unclosed | $45 |", []],
    ["source inside code fences", "```md\n| Name | $|x|$ |\n| --- | --- |\n```", []],
  ] as const)("handles %s alongside GFM tables", (_case, markdown, expected) => {
    expect(formulas(markdown).map(([tex]) => tex)).toEqual(expected);
  });

  it("keeps valid column breaks when literal dollar signs span cells", () => {
    const table = "| $x | y$ | End |\n| --- | --- | --- |\n| $a | b$ | Last |";
    expect(lexBlock(table, false, true)[0]).toMatchObject({
      type: "table", raw: table, header: [{ text: "$x" }, { text: "y$" }, { text: "End" }],
      rows: [[{ text: "$a" }, { text: "b$" }, { text: "Last" }]],
    });
  });
});
