import { Suspense } from "react";
import { AuthForm } from "@/app/components/auth/AuthForm";

export const metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="signin" />
    </Suspense>
  );
}
