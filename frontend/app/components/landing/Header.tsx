import Link from "next/link";

export function Header() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand font-bold text-brand-ink">J</span>
              <span className="text-lg font-semibold">JobPilot</span>
            </div>
            <nav className="flex items-center gap-2 text-sm">
              <Link href="/auth/signin" className="rounded-lg px-3 py-2 text-ink-2 hover:bg-surface-2">Sign in</Link>
              <Link href="/auth/signup" className="rounded-lg bg-brand px-4 py-2 font-medium text-brand-ink hover:opacity-90">Get started free</Link>
            </nav>
          </header>
  );
}
