import { AuthForm } from "@/components/auth-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthForm mode="sign-in" />
    </main>
  );
}
