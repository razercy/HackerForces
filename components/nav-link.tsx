"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentPath } from "@/lib/nav";

/** A navigation link that marks the current section for assistive technology and visually. */
export function NavLink({ href, exact, also, children }: { href: string; exact?: boolean; also?: string[]; children: React.ReactNode }) {
  const current = isCurrentPath(usePathname(), href, { exact, also });
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className="hover:underline aria-[current=page]:font-medium aria-[current=page]:underline aria-[current=page]:underline-offset-4">
      {children}
    </Link>
  );
}
