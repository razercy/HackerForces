"use client";

import { useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
/** false during SSR and hydration, true afterwards, without a setState-in-effect. */
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/**
 * Renders an instant in the viewer's own timezone. The server renders UTC;
 * the browser switches to local time once hydrated.
 */
export function LocalTime({ iso }: { iso: string }) {
  const isClient = useIsClient();
  const d = new Date(iso);
  const text = isClient
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
  return <time dateTime={iso}>{text}</time>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * datetime-local has no timezone, so the browser converts it to an ISO
 * instant (with offset) in a hidden field. The server never guesses a zone.
 */
export function DateTimeField({ name, label, defaultIso, error }: { name: string; label: string; defaultIso?: string; error?: string }) {
  const isClient = useIsClient();
  const [iso, setIso] = useState(defaultIso ?? "");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`${name}-local`} className="font-medium">
        {label} <span className="font-normal text-zinc-500 dark:text-zinc-400">(your local time)</span>
      </label>
      <input
        // Remount after hydration so defaultValue is computed in the viewer's timezone.
        key={isClient ? "client" : "server"}
        id={`${name}-local`}
        type="datetime-local"
        required
        defaultValue={isClient && defaultIso ? toLocalInput(new Date(defaultIso)) : undefined}
        onChange={(e) => setIso(e.target.value ? new Date(e.target.value).toISOString() : "")}
        aria-invalid={!!error}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input type="hidden" name={name} value={iso} />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
