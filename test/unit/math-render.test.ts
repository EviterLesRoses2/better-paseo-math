import { Buffer } from "node:buffer";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { afterAll, describe, expect, it } from "vitest";
import { createTeX, LocalSvg } from "../../server/math/engine";
import { createMathRenderer } from "../../server/math/render";

const taggedInequality = String.raw`\max_{t \ge 0}\big|\delta\dot\omega_g(t) + \beta\delta\omega_g(t)\big|
\le \max_{t \ge 0}|\delta\dot\omega_g(t)| + \beta\max_{t \ge 0}|\delta\omega_g(t)|
= |\delta\dot\omega_g|_{\max} + \beta|\delta\omega_g|_{\max}.
\tag{B}`;
const taggedResult = String.raw`2\pi(1 + \beta).
\tag{C}`;

describe("formula rasterization", () => {
  const renderer = createMathRenderer();
  const settings = { display: true, fontSize: 28, color: "#18181b", scale: 2 };
  afterAll(() => renderer.dispose());

  it.each([
    ["historical inequality with a tag anchor", taggedInequality],
    ["historical tagged result", taggedResult],
    ["tagged aligned rows", String.raw`\begin{align}y &= \frac{a_i+b_i}{c_j}\tag{1}\\y^2 &= b_j\tag*{2}\end{align}`],
    ["tagged multline", String.raw`\begin{multline} a+b+c+d+e \\ +f+g+h+i+j=\frac{2}{y_j}\tag{M}\end{multline}`],
    ["tagged equation with a label", String.raw`\begin{equation}\frac{a_i}{b_j}=q\tag{D}\label{eq:d}\end{equation}`],
    ["untagged fraction and stretchy delimiters", String.raw`\left(\frac{\sqrt{x^2}}{y_j}\right)`],
    ["tag using the CJK fallback font", String.raw`y_j=\frac{a}{b}\tag{结果}`],
  ])("generates a full-sized PNG for %s", async (_name, tex) => {
    const result = await renderer.render({ ...settings, tex });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const png = Buffer.from(result.uri.split(",")[1]!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(result.width * settings.scale);
    expect(png.readUInt32BE(20)).toBe(result.height * settings.scale);
  });

  it("places equation glyphs and the tag in the same fixed coordinate system", async () => {
    const adaptor = liteAdaptor();
    const handler = RegisterHTMLHandler(adaptor);
    try {
      const document = handler.create("", { InputJax: createTeX(), OutputJax: new LocalSvg({ fontCache: "none" }) });
      const node = await document.convertPromise(taggedResult, { display: true, em: 28, ex: 14, containerWidth: 1200 });
      const svg = adaptor.tags(node, "svg");
      expect(svg).toHaveLength(1);
      expect(adaptor.getAttribute(svg[0]!, "viewBox")).toMatch(/^0 -\d+ [\d.]+ \d+$/);
      const labels = adaptor.tags(svg[0]!, "g").find(element => adaptor.getAttribute(element, "data-labels"));
      expect(adaptor.tags(labels!, "path").map(path => adaptor.getAttribute(path, "data-c"))).toEqual(["28", "43", "29"]);
    } finally {
      mathjax.handlers.unregister(handler);
    }
  });

  it("keeps commands that generate external content disabled", async () => {
    expect(await renderer.render({ ...settings, tex: String.raw`x\tag{\href{https://example.com}{B}}` }))
      .toMatchObject({ ok: false, code: "blocked-command" });
  });
});
