"use client";

import Link from "next/link";
import type { Job } from "@/app/types/api";
import { Badge, Score, timeAgo } from "@/app/components/ui";

export const SOURCE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  remotive: "Remotive",
  remoteok: "RemoteOK",
  hn: "HN Who's Hiring",
  yc: "YC",
  wellfound: "Wellfound",
  x: "X",
  linkedin: "LinkedIn",
  manual: "Added by you",
  extension: "Extension",
};

export function salary(job: Pick<Job, "salaryMin" | "salaryMax" | "currency">) {
  if (!job.salaryMin && !job.salaryMax) return null;
  const f = (n: number) => (n >= 100000 && job.currency === "INR" ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const sym = job.currency === "INR" ? "₹" : job.currency === "EUR" ? "€" : job.currency === "GBP" ? "£" : "$";
  return job.salaryMin && job.salaryMax && job.salaryMin !== job.salaryMax ? `${sym}${f(job.salaryMin)}–${f(job.salaryMax)}` : `${sym}${f((job.salaryMax ?? job.salaryMin)!)}`;
}

export function JobCard({ job, actions }: { job: Job; actions?: React.ReactNode }) {
  const pay = salary(job);
  return (
    <div className="flex gap-4 p-4">
      <Score value={job.match?.score ?? 0} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/jobs/${job.id}`} className="font-medium text-ink hover:underline">
            {job.title}
          </Link>
          {job.isHiringPost && <Badge tone="info">Hiring post</Badge>}
          {job.scamScore >= 25 && <Badge tone={job.scamScore >= 50 ? "bad" : "warn"}>⚠ Possible scam</Badge>}
        </div>
        <p className="text-sm text-ink-2">
          {job.companyId ? <Link href={`/companies/${job.companyId}`} className="hover:underline">{job.companyName}</Link> : job.companyName}
          {job.location && <span className="text-ink-3"> · {job.location}</span>}
          {pay && <span className="text-ink-3"> · {pay}</span>}
        </p>
        {job.match?.reasons?.length ? <p className="mt-1 line-clamp-2 text-sm text-ink-3">{job.match.reasons.slice(0, 3).join(" · ")}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {job.remote && <Badge tone="brand">Remote</Badge>}
          {job.employmentType && <Badge>{job.employmentType.replace("_", " ")}</Badge>}
          {job.company?.size && <Badge>{job.company.size}</Badge>}
          {job.sources.map((s) => (
            <Badge key={s.url} tone="neutral">{SOURCE_LABEL[s.source] ?? s.source}</Badge>
          ))}
          <span className="text-xs text-ink-3">{timeAgo(job.postedAt ?? job.createdAt)}</span>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-col items-end gap-2">{actions}</div>}
    </div>
  );
}
