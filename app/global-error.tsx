"use client";

/** Last-resort boundary for errors in the root layout itself. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", maxWidth: 560, margin: "0 auto" }}>
        <h1>Something went wrong</h1>
        <p>HackerForces could not load. Please try again.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  );
}
