// Template matching for C++ sources: what share of a submission is covered
// by registered templates / approved snippets. Pure and deterministic.
//
// Method: strip comments, tokenize (string/char literals, identifiers,
// numbers, operators), then mark every target token that lies inside a
// k-token window also present in some template. Whitespace, comments and
// formatting therefore do not matter; renaming identifiers does (a known
// limitation, documented in docs/integrity.md).

export const SHINGLE_K = 6;

const TOKEN_RE =
  /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|[A-Za-z_]\w*|\d[\w.]*|>>=|<<=|->\*?|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||::|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[+\-*/%=&|^~!<>?:;,.(){}[\]#]/g;

export function tokenize(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  return withoutComments.match(TOKEN_RE) ?? [];
}

const key = (tokens: string[], i: number, k: number) => tokens.slice(i, i + k).join("\u0001");

export function shingles(tokens: string[], k = SHINGLE_K): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + k <= tokens.length; i++) out.add(key(tokens, i, k));
  return out;
}

export type Coverage = { coverage: number; coveredTokens: number; totalTokens: number };

/** Fraction of the target's tokens that fall inside a k-window shared with any template. */
export function templateCoverage(target: string, templates: readonly string[], k = SHINGLE_K): Coverage {
  const tokens = tokenize(target);
  if (tokens.length === 0) return { coverage: 0, coveredTokens: 0, totalTokens: 0 };
  const known = new Set<string>();
  for (const t of templates) for (const s of shingles(tokenize(t), k)) known.add(s);

  const covered = new Uint8Array(tokens.length);
  for (let i = 0; i + k <= tokens.length; i++) {
    if (known.has(key(tokens, i, k))) covered.fill(1, i, i + k);
  }
  const coveredTokens = covered.reduce((n, c) => n + c, 0);
  return { coverage: coveredTokens / tokens.length, coveredTokens, totalTokens: tokens.length };
}
