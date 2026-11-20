"use client";

import { useState } from "react";
import { useSession } from "@/app/(app)/AppShell";
import { Badge, Button, Card, CardHeader, ErrorNote, Input, Loading, PageHeader, Stat, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";

interface Students {
  org: { id: string; name: string; inviteCode: string; seats: number };
  students: { id: string; name: string; email: string; orgRole: string; onboardedAt: string | null; pipeline: Record<string, number>; sent30d: number; replies30d: number }[];
  totals: { students: number; offers: number; interviews: number };
}

const STAGES = ["found", "emailed", "replied", "interview", "offer", "rejected"];

function AdminView() {
  const toast = useToast();
  const { data, loading, reload } = useApi<Students>("/org/students");
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const invite = typeof window !== "undefined" ? `${location.origin}/auth/signup?invite=${data.org.inviteCode}` : "";
  return (
    <>
      <PageHeader title={data.org.name} subtitle="Placement-cell dashboard: every student's pipeline in one place." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students" value={`${data.totals.students} / ${data.org.seats}`} />
        <Stat label="Interviews" value={data.totals.interviews} />
        <Stat label="Offers" value={data.totals.offers} />
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Invite code</p>
          <p className="mt-1 font-mono text-lg font-semibold">{data.org.inviteCode}</p>
          <div className="mt-1 flex gap-2">
            <button className="text-xs text-brand underline" onClick={() => { void navigator.clipboard.writeText(invite); toast("Invite link copied"); }}>Copy link</button>
            <button className="text-xs text-ink-3 underline" onClick={async () => { await post("/org/rotate-invite"); await reload(); toast("New code generated"); }}>Rotate</button>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Students" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="px-5 py-2 font-medium">Student</th>
                {STAGES.map((s) => <th key={s} className="px-2 py-2 text-right font-medium capitalize">{s}</th>)}
                <th className="px-3 py-2 text-right font-medium">Sent 30d</th>
                <th className="px-5 py-2 text-right font-medium">Replies 30d</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.students.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-2.5"><p className="font-medium">{s.name} {s.orgRole === "admin" && <Badge tone="brand">admin</Badge>}</p><p className="text-xs text-ink-3">{s.email}{!s.onboardedAt ? " · not onboarded" : ""}</p></td>
                  {STAGES.map((st) => <td key={st} className="px-2 py-2.5 text-right tabular-nums">{s.pipeline[st] ?? 0}</td>)}
                  <td className="px-3 py-2.5 text-right tabular-nums">{s.sent30d}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{s.replies30d}</td>
                  <td className="pr-4">{s.orgRole !== "admin" && <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Remove ${s.name}?`)) { await post(`/org/students/${s.id}/remove`); await reload(); } }}>Remove</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export default function OrgPage() {
  const { user, org, reload } = useSession();
  const [name, setName] = useState("");
  const [seats, setSeats] = useState(100);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (user.orgRole === "admin") return <AdminView />;
  if (org) return <><PageHeader title={org.name} /><Card className="p-6 text-sm text-ink-2">You&apos;re part of {org.name}. Your placement cell can see your pipeline stats (not your emails).</Card></>;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title="College / placement cell" subtitle="One admin manages many students. Students get Pro features." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-3 p-5">
          <p className="font-semibold">Create an organization</p>
          <Input label="College or placement cell name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Seats" type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
          <Button disabled={name.length < 2} onClick={() => run(() => post("/org", { name, seats }))}>Create</Button>
        </Card>
        <Card className="space-y-3 p-5">
          <p className="font-semibold">Join with an invite code</p>
          <Input label="Invite code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant="secondary" disabled={!code} onClick={() => run(() => post("/org/join", { inviteCode: code }))}>Join</Button>
        </Card>
      </div>
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
    </>
  );
}
