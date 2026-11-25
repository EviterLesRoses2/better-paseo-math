import type { Token, Tokens } from "../../vendor/marked";

export interface InlineMathToken extends Tokens.Generic {
  type: "mathInline";
  text: string;
}

function isEscaped(src: string, index: number): boolean {
  let at = index;
  while (at > 0 && src[at - 1] === "\\") at--;
  return (index - at) % 2 === 1;
}

function readInlineMath(src: string): InlineMathToken | undefined {
  const dollar = src[0] === "$" && src[1] !== "$";
  const paren = src.startsWith("\\(");
  if (!dollar && !paren) return undefined;
  const width = dollar ? 1 : 2;
  if (dollar && /^\s/.test(src.slice(width, width + 1))) return undefined;
  // Inline TeX stays on one line. Give code spans and subsequent Markdown
  // back to marked if a stray dollar sign precedes them.
  const limit = Math.min(src.length, 4096 + width * 2);
  for (let at = width; at < limit; at++) {
    const char = src[at];
    if (char === "\n" || char === "`") return undefined;
    if (!(dollar ? char === "$" : src.startsWith("\\)", at)) || isEscaped(src, at)) continue;
    if (dollar && (/\s/.test(src[at - 1] ?? "") || /[\d$]/.test(src[at + 1] ?? ""))) return undefined;
    const text = src.slice(width, at).trim();
    if (text) return { type: "mathInline", raw: src.slice(0, at + width), text };
    return undefined;
  }
  return undefined;
}

export function inlineMathTokenizer(src: string): Tokens.Generic | undefined {
  // Block delimiters in a sentence are literal. Consume both dollars so the
  // second dollar cannot pair with a later inline opener.
  if (src.startsWith("$$")) return { type: "text", raw: "$$", text: "$$" };
  return readInlineMath(src);
}

export function inlineMathStart(src: string): number | undefined {
  const candidates = /\$+|\\\(/g;
  for (const candidate of src.matchAll(candidates)) {
    const at = candidate.index;
    if ((candidate[0] === "$" || candidate[0] === "\\(") && !isEscaped(src, at) && readInlineMath(src.slice(at))) return at;
  }
  return undefined;
}

/** Escape formula pipes for GFM's cell splitter, which removes the escape. */
export function protectMathTablePipes(line: string, columns?: number): string {
  if (!line.includes("|") || (!line.includes("$") && !line.includes("\\("))) return line;
  const boundary = /`+|\$+|\\\(/g;
  let sourceStart = 0;
  let result = "";
  for (let match = boundary.exec(line); match; match = boundary.exec(line)) {
    const at = match.index;
    const marker = match[0];
    if (isEscaped(line, at)) continue;
    if (marker[0] === "`") {
      const afterOpening = boundary.lastIndex;
      // A code span closes at the next backtick run of the same length.
      let end = boundary.exec(line);
      while (end && end[0] !== marker) end = boundary.exec(line);
      if (!end) boundary.lastIndex = afterOpening;
      continue;
    }
    if (marker[0] === "$" && marker.length > 1) continue;
    const math = readInlineMath(line.slice(at));
    if (!math) continue;
    const escaped = math.raw.replace(/\|/g, (pipe, offset: number) =>
      isEscaped(math.raw, offset) ? pipe : "\\|");
    result += line.slice(sourceStart, at) + escaped;
    sourceStart = at + math.raw.length;
    boundary.lastIndex = sourceStart;
  }
  const protectedLine = result + line.slice(sourceStart);
  if (protectedLine !== line && columns !== undefined) {
    // When the original row already fits, a dollar pair may span separate cells.
    const row = line.trim();
    const separators = [...row.matchAll(/\|/g)].filter(({ index }) =>
      index > 0 && index < row.length - 1 && !isEscaped(row, index));
    if (separators.length + 1 === columns) return line;
  }
  return protectedLine;
}

export function hasInlineMath(tokens: readonly Token[] | undefined): boolean {
  return tokens?.some(token => token.type === "mathInline" || hasInlineMath((token as Tokens.Generic).tokens)) ?? false;
}
