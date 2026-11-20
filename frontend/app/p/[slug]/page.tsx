import type { Metadata } from "next";
import { notFound } from "next/navigation";

interface PublicProfile {
  name: string;
  slug: string;
  headline: string | null;
  summary: string | null;
  skills: string[];
  projects: { name: string; description: string; technologies: string[]; url?: string }[];
  experience: { company: string; title: string; start?: string; end?: string }[];
  education: { institution: string; degree?: string; field?: string; end?: string }[];
  links: { github?: string; linkedin?: string; portfolio?: string };
  hasResume: boolean;
  tailoredFor: string | null;
}

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:3001").replace(/\/+$/, "");

async function load(slug: string, forJob?: string): Promise<PublicProfile | null> {
  const qs = forJob ? `?for=${encodeURIComponent(forJob)}` : "";
  const res = await fetch(`${BACKEND_URL}/api/public/${encodeURIComponent(slug)}${qs}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  return res.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  return p ? { title: p.name, description: p.headline ?? undefined } : { title: "Profile" };
}

/** Public link-in-bio page. `?for=<jobId>` puts the most relevant projects first for that role. */
export default async function PublicProfilePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ for?: string }> }) {
  const { slug } = await params;
  const { for: forJob } = await searchParams;
  const p = await load(slug, forJob);
  if (!p) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
      {p.headline && <p className="mt-1 text-lg text-ink-2">{p.headline}</p>}
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {p.links.github && <a className="text-brand hover:underline" href={p.links.github}>GitHub</a>}
        {p.links.portfolio && <a className="text-brand hover:underline" href={p.links.portfolio}>Portfolio</a>}
        {p.links.linkedin && <a className="text-brand hover:underline" href={p.links.linkedin}>LinkedIn</a>}
        {p.hasResume && <a className="text-brand hover:underline" href={`/backend/public/resume/${p.slug}.pdf`}>Resume (PDF)</a>}
      </div>
      {p.tailoredFor && <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Projects ordered for: {p.tailoredFor}</p>}
      {p.summary && <p className="mt-6 leading-relaxed text-ink-2">{p.summary}</p>}

      {p.skills.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Skills</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full bg-surface-2 px-2.5 py-1 text-sm">{s}</span>)}</div>
        </section>
      )}
      {p.projects.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Projects</h2>
          <ul className="mt-3 space-y-4">
            {p.projects.map((pr) => (
              <li key={pr.name} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <p className="font-medium">{pr.url ? <a href={pr.url} className="hover:underline">{pr.name} ↗</a> : pr.name}</p>
                <p className="mt-1 text-sm text-ink-2">{pr.description}</p>
                <p className="mt-2 text-xs text-ink-3">{pr.technologies.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.experience.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Experience</h2>
          <ul className="mt-3 space-y-2">{p.experience.map((e) => <li key={e.company + e.title} className="text-sm"><span className="font-medium">{e.title}</span>, {e.company} <span className="text-ink-3">{[e.start, e.end].filter(Boolean).join(" – ")}</span></li>)}</ul>
        </section>
      )}
      {p.education.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Education</h2>
          <ul className="mt-3 space-y-2">{p.education.map((e) => <li key={e.institution} className="text-sm"><span className="font-medium">{e.institution}</span>{e.degree ? `, ${e.degree}` : ""}{e.field ? ` in ${e.field}` : ""} <span className="text-ink-3">{e.end}</span></li>)}</ul>
        </section>
      )}
      <p className="mt-12 text-center text-xs text-ink-3">Made with JobPilot</p>
    </main>
  );
}
