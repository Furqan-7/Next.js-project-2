"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Input, Loading, PageHeader, Score, Select, timeAgo, useToast } from "@/app/components/ui";
import { errorMessage, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { EmailAccount } from "@/app/types/api";

interface Check { ok: boolean; record?: string | null; issues?: string[]; selectors?: string[]; hosts?: string[]; provider?: string | null; policy?: string | null }
interface DnsResult { domain: string; hostedProvider: boolean; mx: Check; spf: Check; dkim: Check; dmarc: Check; score: number; guides: { title: string; steps: string[] }[] }
interface Health {
  health: { score: number; factors: { label: string; impact: number }[]; stats: { sent: number; bounced: number; replies: number } };
  lastCheck: { result: DnsResult; createdAt: string } | null;
  placementTests: { id: string; seedEmail: string; result: string; createdAt: string }[];
  suppressions: { id: string; email: string; reason: string; createdAt: string }[];
}

function Row({ name, check, detail }: { name: string; check: Check; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        {detail && <p className="truncate font-mono text-xs text-ink-3">{detail}</p>}
        {check.issues?.map((i) => <p key={i} className="text-xs text-warn">{i}</p>)}
      </div>
      <Badge tone={check.ok ? "ok" : "bad"}>{check.ok ? "✓ Pass" : "✕ Fix"}</Badge>
    </div>
  );
}

export default function DeliverabilityPage() {
  const toast = useToast();
  const accounts = useApi<{ items: EmailAccount[] }>("/mailboxes");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState("");
  const account = accounts.data?.items.find((a) => a.id === selected) ?? accounts.data?.items[0];

  const health = useApi<Health>(account ? `/mailboxes/${account.id}/health` : null);
  const h = health.data;

  if (accounts.loading && !accounts.data) return <Loading />;
  if (!account) return (<><PageHeader title="Deliverability" /><Card><Empty title="No mailbox connected" body="Connect Gmail or Outlook to check SPF, DKIM, DMARC and your inbox health." action={<Link href="/settings" className="text-sm font-medium text-brand">Connect a mailbox →</Link>} /></Card></>);

  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    try {
      await fn();
      toast(ok);
      await Promise.all([health.reload(), accounts.reload()]);
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const dns = h?.lastCheck?.result;
  return (
    <>
      <PageHeader
        title="Deliverability"
        subtitle="Keep your emails out of spam and your account safe."
        actions={
          <>
            {(accounts.data?.items.length ?? 0) > 1 && (
              <Select aria-label="Mailbox" value={account.id} onChange={(e) => setSelected(e.target.value)} className="w-64">
                {accounts.data!.items.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
              </Select>
            )}
            <Button loading={busy === "check"} onClick={() => act("check", () => post(`/mailboxes/${account.id}/check`), "DNS records checked")}>Run checks</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Domain authentication" subtitle={dns ? `${dns.domain} · checked ${timeAgo(h?.lastCheck?.createdAt)}` : "Run checks to see SPF, DKIM and DMARC"} />
            {dns ? (
              <div className="divide-y divide-border">
                <Row name="MX" check={dns.mx} detail={dns.mx.hosts?.slice(0, 2).join(", ") || dns.mx.provider || ""} />
                <Row name="SPF" check={dns.spf} detail={dns.spf.record ?? "missing"} />
                <Row name="DKIM" check={dns.dkim} detail={dns.dkim.selectors?.join(", ") || "no selector found"} />
                <Row name="DMARC" check={dns.dmarc} detail={dns.dmarc.record ?? "missing"} />
              </div>
            ) : <p className="px-5 py-6 text-sm text-ink-3">No checks yet.</p>}
          </Card>
          {dns?.guides.length ? (
            <Card>
              <CardHeader title="Setup guides" />
              <div className="divide-y divide-border">
                {dns.guides.map((g) => (
                  <div key={g.title} className="px-5 py-4">
                    <p className="font-medium">{g.title}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">{g.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Inbox placement test" subtitle="Send a test to another mailbox you own and see whether it lands in Inbox or Spam" />
            <div className="flex flex-wrap items-end gap-2 p-5">
              <div className="min-w-56 flex-1"><Input label="Seed address" type="email" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="your-other-account@gmail.com" /></div>
              <Button loading={busy === "seed"} disabled={!seed} onClick={() => act("seed", () => post(`/mailboxes/${account.id}/placement-test`, { seedEmail: seed }), "Test email sent")}>Send test</Button>
              {accounts.data!.items.filter((a) => a.id !== account.id && a.provider === "gmail").map((s) => (
                <Button key={s.id} variant="secondary" loading={busy === "chk"} onClick={() => act("chk", () => post(`/mailboxes/${account.id}/placement-check`, { seedAccountId: s.id }), "Placement checked")}>Check via {s.email}</Button>
              ))}
            </div>
            {(h?.placementTests.length ?? 0) > 0 && (
              <ul className="divide-y divide-border border-t border-border">
                {h!.placementTests.map((t) => <li key={t.id} className="flex justify-between px-5 py-2.5 text-sm"><span>{t.seedEmail} · {timeAgo(t.createdAt)}</span><Badge tone={t.result === "inbox" ? "ok" : t.result === "spam" ? "bad" : "neutral"}>{t.result}</Badge></li>)}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <Score value={h?.health.score ?? account.healthScore} size="lg" />
              <div><p className="font-semibold">Inbox health</p><p className="text-sm text-ink-3">{account.email}</p></div>
            </div>
            <ul className="mt-4 space-y-1.5 text-sm">
              {(h?.health.factors ?? []).map((f) => <li key={f.label} className={f.impact < 0 ? "text-warn" : "text-ok"}>{f.impact > 0 ? "+" : ""}{f.impact} · {f.label}</li>)}
              {h && h.health.factors.length === 0 && <li className="text-ink-3">No problems found.</li>}
            </ul>
            {h && <p className="mt-3 text-xs text-ink-3">Last 30 days: {h.health.stats.sent} sent, {h.health.stats.bounced} bounced, {h.health.stats.replies} replies</p>}
          </Card>
          <Card className="p-5">
            <p className="font-semibold">Warm-up</p>
            {account.warmupEnabled ? (
              <>
                <p className="mt-1 text-sm text-ink-2">Day {account.warmupDay ?? 1}: up to <span className="font-semibold">{account.todayLimit}</span> emails today (target {account.dailyLimit}/day). Grows about 20% per day.</p>
                <div className="mt-3 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.min(100, (account.todayLimit / account.dailyLimit) * 100)}%` }} /></div>
              </>
            ) : <p className="mt-1 text-sm text-ink-2">Off. Sending up to {account.todayLimit}/day.</p>}
            <p className="mt-3 text-xs text-ink-3">Sent today: {account.sentToday}. Change limits in Settings.</p>
          </Card>
          <Card>
            <CardHeader title="Suppression list" subtitle="Bounced or unsubscribed: never emailed again" />
            {(h?.suppressions.length ?? 0) === 0 ? <p className="px-5 py-5 text-sm text-ink-3">Clean list.</p> : (
              <ul className="max-h-64 divide-y divide-border overflow-y-auto">{h!.suppressions.map((s) => <li key={s.id} className="flex justify-between gap-2 px-5 py-2 text-sm"><span className="truncate font-mono text-xs">{s.email}</span><Badge>{s.reason}</Badge></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
