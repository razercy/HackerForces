import { AuthForm } from "@/components/auth-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthForm mode="sign-up" />
    </main>
  );
}
