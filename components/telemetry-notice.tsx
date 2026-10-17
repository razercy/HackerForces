import { TELEMETRY_NOTICE } from "@/lib/telemetry/notice";

/** The versioned activity-recording notice, rendered verbatim from lib/telemetry/notice.ts. */
export function TelemetryNotice() {
  const n = TELEMETRY_NOTICE;
  return (
    <section id="activity-notice" aria-labelledby="activity-notice-title" className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="activity-notice-title" className="text-base font-semibold">
          {n.title}
        </h2>
        <span className="font-mono text-xs text-zinc-500">Notice version {n.version}</span>
      </div>
      <p>{n.summary}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="font-medium">What is recorded</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
            {n.recorded.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-medium">What is not recorded</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
            {n.notRecorded.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <div>
        <h3 className="font-medium">How it is used</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
          {n.use.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      <p className="text-zinc-700 dark:text-zinc-300">
        <span className="font-medium">Who can see it:</span> {n.access}
      </p>
      <p className="text-zinc-700 dark:text-zinc-300">
        <span className="font-medium">Retention:</span> {n.retention}
      </p>
    </section>
  );
}
