import { AuthForm } from "@/components/auth-form";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthForm mode="sign-up" />
    </main>
  );
}
