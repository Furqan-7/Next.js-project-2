import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-8 md:pt-20">
            <p className="mb-4 inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">For students, freshers and experienced engineers</p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">Stop applying into the void. Email the people who hire.</h1>
            <p className="mt-5 max-w-2xl text-lg text-ink-2">
              Upload your resume once. JobPilot finds roles that fit, finds the founder or hiring manager, writes a personal email that points to your most relevant project, and follows up for you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth/signup" className="rounded-lg bg-brand px-5 py-3 font-medium text-brand-ink hover:opacity-90">Start with your resume</Link>
              <Link href="/auth/signin" className="rounded-lg border border-border bg-surface px-5 py-3 font-medium hover:bg-surface-2">I have an account</Link>
            </div>
          </section>
  );
}
