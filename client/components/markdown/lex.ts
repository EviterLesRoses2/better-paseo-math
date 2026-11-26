/**
 * marked, configured once for the whole engine, and the per-block lexer.
 *
 * Each block is lexed on its own (`blocks.ts` splits the message first), and
 * the result is kept in an LRU keyed by the block's source: a finished block
 * of a streaming reply, or the same snippet in another message, is never
 * lexed twice. Pure module: no React.
 */
import { Lexer, type MarkedOptions, type Token } from "../../vendor/marked";
import { perfCount, perfOn } from "../../debug/perf";
import { insightStart, insightTokenizer } from "./insight";
import { inlineMathStart, inlineMathTokenizer, protectMathTablePipes } from "./inline-math-token";

/**
 * Display math stays together while streaming, including before the closing
 * delimiter has arrived.
 */
export interface MathToken {
  type: "math";
  raw: string;
  text: string;
  closed: boolean;
}

const MATH_CLOSED_RE = /^ {0,3}\$\$([\s\S]*?)\$\$[ \t]*(?:\n+|$)/;
const MATH_OPEN_RE = /^ {0,3}\$\$([\s\S]*)$/;
const BRACKET_MATH_CLOSED_RE = /^ {0,3}\\\[((?:[ \t]*\n[\s\S]*?|[^\n]*?))\\\][ \t]*(?:\n+|$)/;
const BRACKET_MATH_OPEN_RE = /^ {0,3}\\\[[ \t]*(?:\n([\s\S]*)|$)/;
const MATH_START_RE = /(?:^|\n) {0,3}(?:\$\$|\\\[(?=[ \t]*(?:\n|$)|[^\n]*\\\][ \t]*(?:\n|$)))/;

function mathTokenizer(src: string): MathToken | undefined {
  const closed = MATH_CLOSED_RE.exec(src) ?? BRACKET_MATH_CLOSED_RE.exec(src);
  if (closed !== null) {
    return { type: "math", raw: closed[0], text: (closed[1] ?? "").trim(), closed: true };
  }
  const open = MATH_OPEN_RE.exec(src) ?? BRACKET_MATH_OPEN_RE.exec(src);
  if (open !== null) {
    return { type: "math", raw: open[0], text: (open[1] ?? "").trim(), closed: false };
  }
  return undefined;
}

/** Where a math block could interrupt a paragraph, so the paragraph stops there. */
function mathStart(src: string): number | undefined {
  const match = MATH_START_RE.exec(src);
  if (match === null) return undefined;
  return match[0].startsWith("\n") ? match.index + 1 : match.index;
}

const HTML_LINE_BREAK = /^<br\s*\/?>$/i;

/** Bare HTML break tags in inline markup. Raw HTML bodies keep their source. */
export function isInlineHtmlLineBreak(token: { raw: string; inRawBlock?: boolean }): boolean {
  return !token.inRawBlock && HTML_LINE_BREAK.test(token.raw);
}

/**
 * The options every lexer in the engine uses. Extensions are given in the
 * shape `marked.use` would build, so no global marked instance is touched.
 */
export const LEXER_OPTIONS: MarkedOptions = withTokenizerOverrides({
  gfm: true,
  extensions: {
    renderers: {},
    childTokens: {},
    block: [mathTokenizer as never, insightTokenizer],
    startBlock: [mathStart, insightStart],
  },
});

function withTokenizerOverrides(options: MarkedOptions): MarkedOptions {
  // Marked initializes its default tokenizer on the options on construction.
  const tokenizer = new Lexer(options).options.tokenizer!;
  const markedHtml = tokenizer.html;
  tokenizer.html = function (src) {
    const token = markedHtml.call(this, src);
    // A standalone break must not turn the following prose into an HTML block.
    if (token && HTML_LINE_BREAK.test(token.raw.split("\n", 1)[0]!.trim())) return undefined;
    return token;
  };
  const markedTable = tokenizer.table;
  tokenizer.table = function (src) {
    const candidate = this.rules.block.table.exec(src);
    if (!candidate || !this.rules.other.tableDelimiter.test(candidate[2]!)) return undefined;
    const raw = candidate[0];
    if (!raw.includes("$") && !raw.includes("\\(")) return markedTable.call(this, src);

    const columns = candidate[2]!.replace(this.rules.other.tableAlignChars, "").split("|").length;
    const protectedSource = raw.split("\n").map((line, index) =>
      index === 1 ? line : protectMathTablePipes(line, columns)).join("\n");
    if (protectedSource !== raw) {
      const table = markedTable.call(this, protectedSource);
      if (table) {
        // The lexer advances by raw.length. Copy and selection use this source too.
        table.raw = raw;
        return table;
      }
    }
    return markedTable.call(this, src);
  };
  return options;
}

const MATH_LEXER_OPTIONS: MarkedOptions = {
  ...LEXER_OPTIONS,
  extensions: { ...LEXER_OPTIONS.extensions!, inline: [inlineMathTokenizer], startInline: [inlineMathStart] },
};

/** Block-level tokens only: what the splitter needs, without inline work. */
export function lexBlockTokens(markdown: string): Token[] {
  return new Lexer(LEXER_OPTIONS).blockTokens(markdown);
}

function lexWithInline(raw: string, options: MarkedOptions): Token[] {
  const lexer = new Lexer(options);
  const markedInline = lexer.inlineTokens;
  lexer.inlineTokens = function (src, tokens) {
    // Marked passes a token array for queued runs, including each table cell.
    // An unclosed raw tag in one run must not affect the next run.
    if (tokens !== undefined) this.state.inRawBlock = false;
    return markedInline.call(this, src, tokens);
  };
  return lexer.lex(raw);
}

const LRU_LIMIT = 500;
const lru = new Map<string, Token[]>();

/**
 * Streaming tails, kept apart from the LRU. Each chunk makes a new tail that
 * is never drawn again, so in the LRU they would push out finished blocks and
 * hold hundreds of partial copies of the same paragraph (about 2.5 MB after
 * `markdown-long`). A few slots cover the replies streaming at once and the
 * probe's second read of the same tail.
 */
const TAIL_LIMIT = 8;
const tails = new Map<string, Token[]>();

/**
 * The full token tree (block and inline) of one block's source. Callers must
 * treat the result as read-only: it is shared by every block with this
 * source. `open` marks the tail of a reply that is still streaming.
 */
export function lexBlock(raw: string, open = false, inlineMath = false): Token[] {
  // Distinguish math-enabled and ordinary source with independent key prefixes.
  const cacheKey = inlineMath ? `math:${raw}` : `plain:${raw}`;
  const options = inlineMath ? MATH_LEXER_OPTIONS : LEXER_OPTIONS;
  const hit = lru.get(cacheKey);
  if (hit !== undefined) {
    // Re-inserting moves the key to the young end of the insertion order.
    lru.delete(cacheKey);
    lru.set(cacheKey, hit);
    return hit;
  }
  if (!open && perfOn()) perfCount("md.lexFinalMiss");
  if (open) {
    const tail = tails.get(cacheKey);
    if (tail !== undefined) return tail;
    const tokens = lexWithInline(raw, options);
    tails.set(cacheKey, tokens);
    if (tails.size > TAIL_LIMIT) {
      const oldest = tails.keys().next().value;
      if (oldest !== undefined) tails.delete(oldest);
    }
    return tokens;
  }
  const tokens = lexWithInline(raw, options);
  lru.set(cacheKey, tokens);
  while (lru.size > LRU_LIMIT) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
  return tokens;
}

/** The kind a reader sees for a block: its first token that is not blank space. */
export function blockKind(tokens: readonly Token[]): string {
  for (const token of tokens) {
    if (token.type !== "space" && token.type !== "def") return token.type;
  }
  return "empty";
}

const WARM_UP_SAMPLE =
  "# a\n\nb **c** *d* ~~e~~ `f` [g](https://h.io) www.i.io\n\n- j\n  - [x] k\n\n1. l\n\n> m\n\n" +
  "| n | o |\n| :- | -: |\n| 1 | 2 |\n\n```ts\nconst p = 1;\n```\n\n$$\nq\n$$\n";

/**
 * Runs the lexer once over every construct, outside any render. The first
 * lex in a fresh runtime compiles marked's expressions, which would otherwise
 * land on the first reply's commit. Nothing is cached.
 */
export function warmLexer(): void {
  Lexer.lex(WARM_UP_SAMPLE, LEXER_OPTIONS);
}

/** Test seam: the LRU's current size. */
export function lexCacheSize(): number {
  return lru.size;
}
