"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ContactRow } from "@/app/components/outreach/ContactRow";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Input, Loading, PageHeader, timeAgo, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Company, Contact, Job } from "@/app/types/api";

interface CompanyResp {
  company: Company;
  contacts: Contact[];
  jobs: Job[];
  funding: { id: string; title: string; url: string; amount: string | null; round: string | null }[];
  referrals: Contact[];
  alumni: { name: string; title: string }[];
}

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, loading, error, reload } = useApi<CompanyResp>(`/companies/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [add, setAdd] = useState({ name: "", title: "", email: "", linkedinUrl: "" });
  const [showAdd, setShowAdd] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote>{error ?? "Not found"}</ErrorNote>;
  const { company, contacts, jobs, funding, referrals, alumni } = data;

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    try {
      toast(await fn());
      await reload();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title={company.name}
        subtitle={[company.domain, company.location, company.size, company.teamSize ? `${company.teamSize} people` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button variant="secondary" loading={busy === "research"} onClick={() => run("research", async () => { await post(`/companies/${id}/research`); return "Research card updated"; })}>Refresh research</Button>
            <Button loading={busy === "people"} disabled={!company.domain} title={company.domain ? undefined : "Add the company website first"} onClick={() => run("people", async () => {
              const r = await post<{ contacts: Contact[]; pattern: { pattern: string | null; confidence: number } }>(`/companies/${id}/find-people`);
              return `Found ${r.contacts.length} people${r.pattern.pattern ? `; email pattern ${r.pattern.pattern}@` : ""}`;
            })}>Find people & emails</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="People"
              subtitle={company.emailPattern ? `Email pattern: ${company.emailPattern}@${company.domain} (${Math.round(company.emailPatternConfidence * 100)}% confident)` : "We verify every address (MX and SMTP) before you send"}
              action={<Button size="sm" variant="secondary" onClick={() => setShowAdd(!showAdd)}>Add person</Button>}
            />
            {showAdd && (
              <form
                className="grid gap-3 border-b border-border p-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("add", async () => {
                    await post(`/companies/${id}/contacts`, { name: add.name, title: add.title || undefined, email: add.email || undefined, linkedinUrl: add.linkedinUrl || undefined });
                    setAdd({ name: "", title: "", email: "", linkedinUrl: "" });
                    setShowAdd(false);
                    return "Added. We guessed and checked their email";
                  });
                }}
              >
                <Input label="Full name" required value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
                <Input label="Title" value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} />
                <Input label="Email (if known)" type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
                <Input label="LinkedIn URL" value={add.linkedinUrl} onChange={(e) => setAdd({ ...add, linkedinUrl: e.target.value })} />
                <div className="sm:col-span-2"><Button type="submit" loading={busy === "add"}>Save person</Button></div>
              </form>
            )}
            {contacts.length ? <div className="divide-y divide-border">{contacts.map((c) => <ContactRow key={c.id} contact={c} jobId={jobs[0]?.id} onChange={reload} />)}</div> : <Empty title="No people yet" body="Click “Find people & emails” to search the company site, GitHub and job posts." />}
          </Card>

          <Card>
            <CardHeader title="Open roles" />
            {jobs.length ? (
              <ul className="divide-y divide-border">
                {jobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link>
                      <p className="text-xs text-ink-3">{j.location ?? ""} · {timeAgo(j.createdAt)}</p>
                    </div>
                    {j.remote && <Badge tone="brand">Remote</Badge>}
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-sm text-ink-3">No open roles tracked. Cold outreach still works: startups often hire before they post.</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Research card</p>
            <p className="mt-2 text-sm text-ink">{company.product ?? company.description ?? "Run research to fill this in."}</p>
            <dl className="mt-4 space-y-2 text-sm">
              {company.industry && <div className="flex justify-between gap-2"><dt className="text-ink-3">Industry</dt><dd>{company.industry}</dd></div>}
              {company.fundingStage && <div className="flex justify-between gap-2"><dt className="text-ink-3">Stage</dt><dd>{company.fundingStage}</dd></div>}
              {company.teamSize && <div className="flex justify-between gap-2"><dt className="text-ink-3">Team</dt><dd>{company.teamSize}</dd></div>}
              {company.website && <div className="flex justify-between gap-2"><dt className="text-ink-3">Website</dt><dd><a href={company.website} className="text-brand hover:underline" target="_blank" rel="noreferrer">{company.domain} ↗</a></dd></div>}
            </dl>
            {company.techStack.length > 0 && (
              <>
                <p className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-ink-3">Tech stack</p>
                <div className="flex flex-wrap gap-1.5">{company.techStack.map((t) => <Badge key={t}>{t}</Badge>)}</div>
              </>
            )}
            {company.researchedAt && <p className="mt-4 text-xs text-ink-3">Updated {timeAgo(company.researchedAt)}</p>}
          </Card>

          {(funding.length > 0 || company.recentNews.length > 0) && (
            <Card>
              <CardHeader title="Recent news" />
              <ul className="divide-y divide-border">
                {funding.map((f) => <li key={f.id} className="px-5 py-3 text-sm"><Badge tone="ok" className="mr-1">{[f.amount, f.round].filter(Boolean).join(" ")}</Badge><a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">{f.title}</a></li>)}
                {company.recentNews.filter((n) => !funding.some((f) => f.title === n.title)).slice(0, 5).map((n) => (
                  <li key={n.title} className="px-5 py-3 text-sm">{n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">{n.title}</a> : n.title}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Referral paths" subtitle="Alumni from your college here" />
            {referrals.length + alumni.length === 0 ? <p className="px-5 py-5 text-sm text-ink-3">No alumni found yet. Add your college in Settings; on the College plan, classmates&apos; past employers show up here too.</p> : (
              <ul className="divide-y divide-border">
                {referrals.map((r) => <li key={r.id} className="px-5 py-3 text-sm"><span className="font-medium">{r.name}</span> · {r.title} <Badge tone="info">{r.college}</Badge></li>)}
                {alumni.map((a) => <li key={a.name + a.title} className="px-5 py-3 text-sm"><span className="font-medium">{a.name}</span> · was {a.title} <Badge tone="info">classmate</Badge></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
