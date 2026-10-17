import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentUser } from "@/lib/server/authz";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">HackerForces</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Competitive programming with an instrumented browser IDE and transparent, human-reviewed integrity signals.
        </p>
      </header>

      {user ? (
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p>
            Signed in as <strong>{user.name}</strong> ({user.email})
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Roles: {user.roles.join(", ")}</p>
          <div>
            <SignOutButton />
          </div>
        </section>
      ) : (
        <div className="flex gap-3">
          <Link href="/sign-in" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Create an account
          </Link>
        </div>
      )}
    </main>
  );
}
