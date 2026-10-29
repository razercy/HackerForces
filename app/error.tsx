"use client";

/** Route-level error boundary. Shows a generic message; details stay in server logs. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 px-4 py-16">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The page could not be loaded. Your submissions and drafts are not affected.
        {error.digest ? (
          <>
            {" "}
            Reference: <code className="font-mono text-xs">{error.digest}</code>
          </>
        ) : null}
      </p>
      <div>
        <button type="button" onClick={reset} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Try again
        </button>
      </div>
    </main>
  );
}
