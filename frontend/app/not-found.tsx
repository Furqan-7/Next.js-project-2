import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl font-semibold">404</p>
      <p className="text-ink-2">This page doesn&apos;t exist.</p>
      <Link href="/" className="text-sm font-medium text-brand">Go home →</Link>
    </div>
  );
}
