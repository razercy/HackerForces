import { ProblemForm } from "@/components/manage/problem-form";
import { createProblemAction } from "../actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "New problem" };

export default function NewProblemPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New problem</h1>
      <ProblemForm action={createProblemAction} submitLabel="Create problem" />
    </section>
  );
}
