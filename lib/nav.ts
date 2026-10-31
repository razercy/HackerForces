/** Pure, client-safe: whether a navigation link points at the page being viewed (or a page below it). */
export function isCurrentPath(pathname: string, href: string, { exact = false, also = [] }: { exact?: boolean; also?: string[] } = {}): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return (exact ? pathname === href : under(href)) || also.some(under);
}
