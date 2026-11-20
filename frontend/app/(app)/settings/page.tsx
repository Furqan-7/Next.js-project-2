"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSession } from "@/app/(app)/AppShell";
import { Badge, Button, Card, CardHeader, Input, Loading, PageHeader, TagInput, Textarea, useToast } from "@/app/components/ui";
import { api, del, errorMessage, patch, post, put } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { EmailAccount } from "@/app/types/api";

interface Billing { plan: string; plans: { id: string; label: string; priceMonthlyUsd: number; dailySends: number; monthlyAiDrafts: number; autopilot: boolean; mailboxes: number }[]; usage: Record<string, { used: number; limit: number; period: string }> }

function SettingsInner() {
  const toast = useToast();
  const params = useSearchParams();
  const { user, profile, reload } = useSession();
  const mailboxes = useApi<{ items: EmailAccount[]; oauth: { google: boolean; microsoft: boolean } }>("/mailboxes");
  const billing = useApi<Billing>("/billing");
  const [busy, setBusy] = useState<string | null>(null);
  const [p, setP] = useState({ headline: profile.headline ?? "", skills: profile.skills, github: profile.links.github ?? "", portfolio: profile.links.portfolio ?? "", linkedin: profile.links.linkedin ?? "", writingSample: profile.writingSample ?? "", college: profile.college ?? "", resumeUrl: profile.resumeUrl ?? "", publicVisible: profile.publicVisible });
  const [prefs, setPrefs] = useState({ ...user.notificationPrefs, phone: user.phone ?? "" });

  useEffect(() => {
    if (params.get("mailbox") === "connected") toast("Mailbox connected. Reply tracking is on");
    if (params.get("mailbox_error")) toast(`Couldn't connect mailbox: ${params.get("mailbox_error")}`, "bad");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(what);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  const connect = (provider: "google" | "microsoft") => act(provider, async () => {
    const { url } = await post<{ url: string }>(`/mailboxes/oauth/${provider}/start`);
    location.href = url;
  });

  const enablePush = () => act("push", async () => {
    const { publicKey } = await api<{ publicKey: string | null }>("/notifications/vapid");
    if (!publicKey) throw new Error("Push isn't configured on the server (VAPID keys)");
    if (!("serviceWorker" in navigator)) throw new Error("This browser doesn't support push");
    const reg = await navigator.serviceWorker.register("/sw.js");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications were blocked");
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await post("/notifications/push-subscribe", sub.toJSON());
    await put("/notifications/prefs", { ...prefs, push: true });
    setPrefs({ ...prefs, push: true });
  }, "Push notifications on");

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Mailboxes" subtitle="Emails go out from your own account via OAuth. We never send from a shared server." />
          <div className="divide-y divide-border">
            {(mailboxes.data?.items ?? []).map((a) => (
              <div key={a.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{a.email} <Badge className="ml-1">{a.provider === "dev" ? "dev (captures only)" : a.provider}</Badge> <Badge tone={a.status === "active" ? "ok" : "bad"}>{a.status}</Badge></p>
                  <p className="text-xs text-ink-3">Health {a.healthScore}/100 · {a.sentToday} sent today{a.lastError ? ` · ${a.lastError}` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">Daily limit
                    <input type="number" min={1} max={500} defaultValue={a.dailyLimit} aria-label="Daily limit" className="h-8 w-20 rounded-md border border-border bg-surface px-2" onBlur={(e) => act("lim", () => patch(`/mailboxes/${a.id}`, { dailyLimit: Number(e.target.value) }), "Limit saved")} />
                  </label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={a.warmupEnabled} onChange={(e) => act("warm", () => patch(`/mailboxes/${a.id}`, { warmupEnabled: e.target.checked }), "Saved")} /> Warm-up</label>
                  <Button size="sm" variant="ghost" onClick={() => act("del", async () => { await del(`/mailboxes/${a.id}`); await mailboxes.reload(); }, "Disconnected")}>Disconnect</Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 p-5">
              <Button loading={busy === "google"} onClick={() => connect("google")} disabled={Boolean(mailboxes.data && !mailboxes.data.oauth.google)} title={mailboxes.data?.oauth.google ? undefined : "Server needs GOOGLE_CLIENT_ID"}>Connect Gmail</Button>
              <Button variant="secondary" loading={busy === "microsoft"} onClick={() => connect("microsoft")} disabled={Boolean(mailboxes.data && !mailboxes.data.oauth.microsoft)} title={mailboxes.data?.oauth.microsoft ? undefined : "Server needs MICROSOFT_CLIENT_ID"}>Connect Outlook</Button>
              <Button variant="ghost" loading={busy === "dev"} onClick={() => act("dev", async () => { await post("/mailboxes/dev"); await mailboxes.reload(); }, "Dev mailbox added: emails are captured, not delivered")}>Add dev mailbox (testing)</Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Profile" subtitle="Used for matching and personalisation" />
          <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); void act("profile", async () => {
            await put("/profile", { headline: p.headline, skills: p.skills, writingSample: p.writingSample || undefined, college: p.college || undefined, publicVisible: p.publicVisible, resumeUrl: p.resumeUrl });
            await post("/profile/enrich", Object.fromEntries(Object.entries({ github: p.github, portfolio: p.portfolio, linkedin: p.linkedin }).filter(([k, v]) => v && v !== (profile.links as Record<string, string | undefined>)[k])));
            await reload();
          }, "Profile saved and jobs re-scored"); }}>
            <Input label="Headline" value={p.headline} onChange={(e) => setP({ ...p, headline: e.target.value })} />
            <div><p className="mb-1 text-sm font-medium text-ink-2">Skills</p><TagInput value={p.skills} onChange={(v) => setP({ ...p, skills: v })} /></div>
            <Input label="GitHub" value={p.github} onChange={(e) => setP({ ...p, github: e.target.value })} />
            <Input label="Portfolio" value={p.portfolio} onChange={(e) => setP({ ...p, portfolio: e.target.value })} />
            <Input label="LinkedIn" value={p.linkedin} onChange={(e) => setP({ ...p, linkedin: e.target.value })} />
            <Input label="College" value={p.college} onChange={(e) => setP({ ...p, college: e.target.value })} />
            <Input label="Resume link to include in emails" value={p.resumeUrl} onChange={(e) => setP({ ...p, resumeUrl: e.target.value })} hint="Defaults to your uploaded resume or public profile" />
            <Textarea label="Writing sample" rows={4} value={p.writingSample} onChange={(e) => setP({ ...p, writingSample: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.publicVisible} onChange={(e) => setP({ ...p, publicVisible: e.target.checked })} /> Public profile at <a className="text-brand" href={`/p/${user.publicSlug}`} target="_blank" rel="noreferrer">/p/{user.publicSlug}</a></label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === "profile"}>Save profile</Button>
              <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2">
                Re-upload resume
                <input type="file" accept=".pdf,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void act("resume", async () => {
                  const fd = new FormData();
                  fd.append("file", f);
                  const r = await api<{ profile: { skills: string[]; headline: string | null } }>("/profile/resume", { method: "POST", body: fd });
                  setP((cur) => ({ ...cur, skills: r.profile.skills, headline: r.profile.headline ?? cur.headline }));
                  await reload();
                }, "Resume parsed: skills and projects updated"); }} />
              </label>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Plan & usage" />
            {billing.data ? (
              <div className="space-y-4 p-5">
                {Object.entries(billing.data.usage).map(([k, u]) => (
                  <div key={k}>
                    <div className="flex justify-between text-sm"><span className="capitalize text-ink-2">{k.replace("_", " ")}</span><span className="tabular-nums">{u.used} / {u.limit} per {u.period}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} /></div>
                  </div>
                ))}
                <div className="grid gap-2 sm:grid-cols-2">
                  {billing.data.plans.filter((x) => x.id !== "college").map((pl) => (
                    <div key={pl.id} className={`rounded-lg border p-3 ${billing.data!.plan === pl.id ? "border-brand" : "border-border"}`}>
                      <p className="font-medium">{pl.label} · ${pl.priceMonthlyUsd}/mo</p>
                      <p className="text-xs text-ink-3">{pl.dailySends} sends/day · {pl.monthlyAiDrafts} AI drafts · {pl.mailboxes} mailbox{pl.mailboxes > 1 ? "es" : ""}{pl.autopilot ? " · autopilot" : ""}</p>
                      {billing.data!.plan !== pl.id && billing.data!.plan !== "college" && <Button size="sm" className="mt-2" loading={busy === pl.id} onClick={() => act(pl.id, async () => { await post("/billing/plan", { plan: pl.id }); await billing.reload(); await reload(); }, `Switched to ${pl.label}`)}>Switch</Button>}
                    </div>
                  ))}
                </div>
                {billing.data.plan === "college" && <p className="text-sm text-ink-3">Your plan is provided by your college.</p>}
              </div>
            ) : <Loading />}
          </Card>
          <Card>
            <CardHeader title="Notifications" subtitle="When someone replies or an interview is booked" />
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between"><span className="text-sm">Browser push</span>{prefs.push ? <Badge tone="ok">On</Badge> : <Button size="sm" variant="secondary" loading={busy === "push"} onClick={enablePush}>Enable</Button>}</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.whatsapp} onChange={(e) => setPrefs({ ...prefs, whatsapp: e.target.checked })} /> WhatsApp {user.plan === "free" && <Badge>Pro</Badge>}</label>
              {prefs.whatsapp && <Input label="WhatsApp number" placeholder="+91 98765 43210" value={prefs.phone} onChange={(e) => setPrefs({ ...prefs, phone: e.target.value })} />}
              <Button size="sm" loading={busy === "prefs"} onClick={() => act("prefs", () => put("/notifications/prefs", prefs), "Saved")}>Save</Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsInner />
    </Suspense>
  );
}
