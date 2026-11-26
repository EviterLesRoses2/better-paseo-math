import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactTestInstance } from "react-test-renderer";
import { Lexer, type Tokens } from "../../client/vendor/marked";
import { lexBlock } from "../../client/components/markdown/lex";
import { repairTail } from "../../client/components/markdown/repair";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: object) => React.createElement("Icon", props),
    ScrollView: rn.ScrollView,
    copyText: () => Promise.resolve(true),
    useToast: () => ({ show: () => {} }),
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ data: undefined }),
  useRpc: () => async () => null,
}));
vi.mock("../../client/components/markdown/render/use-formula", () => ({
  useFormula: () => ({
    image: { uri: "data:image/png;base64,AAAA", width: 20, height: 14, depth: 2 },
    imageScale: 1,
    viewportWidth: 800,
  }),
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { inlineText, inlineWidth } = await import("../../client/components/markdown/render/inline");
const { columnWidths } = await import("../../client/components/markdown/render/table");
const { rangeText } = await import("../../client/components/markdown/render/table-range");
const { variantMetrics } = await import("../../client/components/markdown/render/styles");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const os = globalThis as { __rnMockOS?: string };
afterEach(() => { delete os.__rnMockOS; });

const theme = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});

function table(source: string, open = false): Tokens.Table {
  const token = lexBlock(source, open, true)[0];
  expect(token?.type).toBe("table");
  return token as Tokens.Table;
}

function oneColumn(header: string, body: string): Tokens.Table {
  return table(`| ${header} |\n| --- |\n| ${body} |`);
}

function readText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : readText(child)).join("");
}

async function render(text: string) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(MarkdownView, {
      text, tokens: theme, variant: "document", renderMath: true,
    }));
  });
  return renderer;
}

function cells(renderer: ReturnType<typeof TestRenderer.create>) {
  return renderer.root.findAll((node) => String(node.type) === "Text" && node.props.testID === "markdown-table-cell");
}

describe("HTML breaks in Markdown", () => {
  it.each(["<br>", "<br/>", "<br />", "<BR>", "<Br   />", "<br\t>"])(
    "lexes %s as HTML and uses it as a break in table headers and rows",
    (tag) => {
      const token = oneColumn(`A${tag}B`, `甲${tag}乙`);
      const [header, body] = [token.header[0]!, token.rows[0]![0]!];
      for (const cell of [header, body]) {
        expect(cell.tokens.map((run) => run.type)).toEqual(["text", "html", "text"]);
        expect(cell.tokens[1]!.raw).toBe(tag);
      }
      expect(inlineText(header.tokens)).toBe("A\nB");
      expect(inlineText(body.tokens)).toBe("甲\n乙");
    },
  );

  it("keeps breaks between and inside formatted runs", () => {
    const cell = oneColumn("Head",
      "**A**<br>**B**<br>*c<BR>d*<br>[甲<Br/>乙](https://example.com)<br><br>End").rows[0]![0]!;
    expect(inlineText(cell.tokens)).toBe("A\nB\nc\nd\n甲\n乙\n\nEnd");
    expect(cell.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "em", tokens: expect.arrayContaining([
        expect.objectContaining({ type: "html", raw: "<BR>" }),
      ]) }),
      expect.objectContaining({ type: "link", tokens: expect.arrayContaining([
        expect.objectContaining({ type: "html", raw: "<Br/>" }),
      ]) }),
    ]));
  });

  it("renders literal tags, entities, code and escapes without interpreting them", async () => {
    const source = "| Header |\n| --- |\n" +
      "| `<br>` \\<br\\> &lt;br&gt;<br><span>x</span> <div> <br class=\"x\"> <script>x<br>y</script> |";
    const renderer = await render(source);
    try {
      expect(cells(renderer).map(readText)).toEqual([
        "Header", '<br> <br> <br>\n<span>x</span> <div> <br class="x"> <script>x<br>y</script>',
      ]);
    } finally { await act(async () => renderer.unmount()); }
  });

  it("does not let a literal raw tag stop breaks in subsequent cells", () => {
    const token = table("| <script> | A<br>B |\n| --- | --- |\n| C<br>D | E |");
    expect(token.header.map((cell) => inlineText(cell.tokens))).toEqual(["<script>", "A\nB"]);
    expect(token.rows[0]!.map((cell) => inlineText(cell.tokens))).toEqual(["C\nD", "E"]);
  });

  it("keeps a standalone break out of a raw HTML block", () => {
    const [breakToken, heading] = lexBlock("<Br />\n# Heading");
    expect(breakToken).toMatchObject({ type: "paragraph", tokens: [{ type: "html", raw: "<Br />" }] });
    expect(heading).toMatchObject({ type: "heading", text: "Heading" });
    expect(lexBlock("<div>\n<br>\n</div>")[0]).toMatchObject({ type: "html", raw: "<div>\n<br>\n</div>" });
  });

  it("measures the widest line across HTML, Markdown and embedded text breaks", () => {
    const nested = (source: string) => Lexer.lexInline(source, { gfm: true });
    expect(inlineWidth(nested("aa[bb<br>cccc](https://example.com)ddd"), 10, 0.5)).toBe(35);
    expect(inlineWidth(nested("aaa  \nbbbb"), 10, 0.5)).toBe(20);
    expect(inlineWidth(nested("甲\n乙丙"), 10, 0.5)).toBe(20);
    expect(inlineWidth(nested("<span>a</span>"), 10, 0.5)).toBe(70);
    expect(inlineWidth(nested("<br><br>"), 10, 0.5)).toBe(0);
  });

  it("sizes each column as if it contained only its longest visible line", () => {
    const metrics = variantMetrics("document", 16);
    const widest = "x".repeat(20);
    const shorter = "y".repeat(16);
    const plain = columnWidths(oneColumn("Header", widest), metrics);
    expect(columnWidths(oneColumn("Header", `${shorter}<br>${widest}<br>${shorter}`), metrics)).toEqual(plain);
    expect(plain[0]).toBeLessThan(columnWidths(oneColumn("Header", widest + shorter), metrics)[0]!);
  });

  it("copies a single cell as text and reparses a multicell copy as GFM", () => {
    const formula = String.raw`$\max |a|$<Br/>$\min |b|$`;
    const parsed = table(`| A<br>B | Other |\n| :--- | ---: |\n| ${formula} | C<BR>D |`);
    const at = (row: number, column: number) => [{ top: row, left: column, bottom: row, right: column }];
    expect(rangeText(parsed, at(0, 0))).toBe("A\nB");
    expect(rangeText(parsed, at(1, 0))).toBe(String.raw`$\max |a|$` + "\n" + String.raw`$\min |b|$`);
    expect(parsed.rows[0]![0]!.tokens.map((token) => token.type)).toEqual(["mathInline", "html", "mathInline"]);
    const copied = rangeText(parsed, [{ top: 1, left: 0, bottom: 1, right: 1 }]);
    expect(copied).toBe("| A<br>B | Other |\n| :--- | ---: |\n" +
      String.raw`| $\max \|a\|$<Br/>$\min \|b\|$ | C<BR>D |`);
    expect(Lexer.lex(copied, { gfm: true })[0]).toMatchObject({
      type: "table", align: ["left", "right"],
      header: [{ text: "A<br>B" }, { text: "Other" }],
      rows: [[{ text: formula }, { text: "C<BR>D" }]],
    });
  });

  it("keeps streaming table cells intact with a partial break next to math pipes", () => {
    const start = String.raw`| $\max |a|$`;
    const delimiter = "| --- | --- |";
    const header = table(repairTail(`${start}<br>Limit | Other |`), true);
    expect(header.header.map((cell) => inlineText(cell.tokens))).toEqual([String.raw`$\max |a|$` + "\nLimit", "Other"]);

    const rows = `| Formula | Other |\n${delimiter}\n${start}`;
    for (const suffix of ["<", "<B", "<Br", "<Br ", "<Br /"]) {
      const partial = table(repairTail(rows + suffix), true);
      expect(partial.rows[0]).toHaveLength(2);
      expect(inlineText(partial.rows[0]![0]!.tokens)).not.toContain("\n");
    }
    const finished = table(repairTail(rows + String.raw`<Br />$\min |b|$ | End |`), true);
    expect(finished.rows[0]!.map((cell) => inlineText(cell.tokens))).toEqual([
      String.raw`$\max |a|$` + "\n" + String.raw`$\min |b|$`, "End",
    ]);
  });

  it.each(["web", "ios", "android"])("renders formula attachments on separate lines on %s", async (platform) => {
    os.__rnMockOS = platform;
    const renderer = await render("| Math | Mixed |\n| --- | --- |\n" +
      "| $x_1$<br>$x_2$ | Line 1<br>$x^2$<br>Line 3 |\n\n" +
      "| A<BR>B |\n| --- |\n| 甲<Br /><br>乙 |");
    try {
      const result = cells(renderer);
      const imageType = platform === "web" ? "img" : "Image";
      const parts = (cell: ReactTestInstance) => cell.children.map((child) => typeof child === "string"
        ? child : child.findAll((node) => String(node.type) === imageType).length);
      expect(parts(result[2]!)).toEqual([1, "\n", 1]);
      expect(parts(result[3]!)).toEqual(["Line 1", "\n", 1, "\n", "Line 3"]);
      expect(result.slice(4).map(readText)).toEqual(["A\nB", "甲\n\n乙"]);
    } finally { await act(async () => renderer.unmount()); }
  });
});
