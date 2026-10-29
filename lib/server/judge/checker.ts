/**
 * Standard competitive-programming output check: outputs match when their
 * whitespace-separated tokens are identical. Trailing spaces, blank lines and
 * \r\n vs \n therefore never matter; token content and order always do.
 */
export function tokensMatch(actual: string, expected: string): boolean {
  const a = actual.split(/\s+/).filter(Boolean);
  const e = expected.split(/\s+/).filter(Boolean);
  if (a.length !== e.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== e[i]) return false;
  return true;
}
