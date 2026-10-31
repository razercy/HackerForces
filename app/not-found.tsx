import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 px-4 py-16">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className="text-sm underline">
        Go to the home page
      </Link>
    </main>
  );
}
