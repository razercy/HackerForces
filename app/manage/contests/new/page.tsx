import { ContestForm } from "@/components/manage/contest-forms";
import { createContestAction } from "../actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "New contest" };

export default function NewContestPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New contest</h1>
      <ContestForm action={createContestAction} submitLabel="Create contest" />
    </section>
  );
}
