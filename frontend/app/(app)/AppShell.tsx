"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, post } from "@/app/services/api";
import { useApi } from "@/app/hooks/useApi";
import type { Notification, Profile, User } from "@/app/types/api";
import { Badge, Button, cx, Loading, timeAgo, useToast } from "@/app/components/ui";

interface Session {
  user: User;
  profile: Profile;
  org: { id: string; name: string; inviteCode: string; seats: number } | null;
  reload: () => Promise<void>;
}
const SessionCtx = createContext<Session | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside Shell");
  return s;
}

const NAV: { href: string; label: string; icon: string; admin?: boolean }[] = [
  { href: "/dashboard", label: "Today", icon: "◎" },
  { href: "/jobs", label: "Jobs", icon: "⌕" },
  { href: "/outreach", label: "Outreach", icon: "✉" },
  { href: "/campaigns", label: "Campaigns", icon: "⇉" },
  { href: "/inbox", label: "Inbox", icon: "⤶" },
  { href: "/tracker", label: "Tracker", icon: "▦" },
  { href: "/analytics", label: "Analytics", icon: "%" },
  { href: "/deliverability", label: "Deliverability", icon: "✓" },
  { href: "/org", label: "Placement cell", icon: "⌂", admin: true },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [session, setSession] = useState<Omit<Session, "reload"> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const notifications = useApi<{ items: Notification[]; unread: number }>("/notifications");
  const [showNotes, setShowNotes] = useState(false);

  const load = async () => {
    try {
      setSession(await api<Omit<Session, "reload">>("/auth/me"));
    } catch {
      /* api() sends you to the sign-in page on 401 */
    }
  };
  useEffect(() => {
    let alive = true;
    api<Omit<Session, "reload">>("/auth/me")
      .then((s) => {
        if (!alive) return;
        setSession(s);
        if (!s.user.onboardedAt) router.replace("/onboarding");
      })
      .catch(() => undefined); // api() sends you to the sign-in page on 401
    return () => {
      alive = false;
    };
  }, [router]);

  if (!session) return <Loading label="Loading your workspace…" />;
  const paused = session.user.sendingPaused;
  const togglePause = async () => {
    await post(paused ? "/sending/resume" : "/sending/pause");
    toast(paused ? "Sending resumed" : "All sending paused");
    await load();
  };

  const nav = NAV.filter((n) => !n.admin || session.user.orgRole === "admin");
  return (
    <SessionCtx.Provider value={{ ...session, reload: load }}>
      <div className="min-h-screen md:flex">
        {/* Sidebar */}
        <aside className={cx("fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-border bg-surface p-3 md:sticky md:top-0 md:flex md:h-screen", menuOpen ? "flex" : "hidden")}>
          <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 py-1.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-ink">J</span>
            <span className="font-semibold text-ink">JobPilot</span>
          </Link>
          <nav className="flex flex-1 flex-col gap-0.5">
            {nav.map((n) => {
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <Link key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className={cx("flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm", active ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-surface-2")}>
                  <span aria-hidden className="w-4 text-center">{n.icon}</span>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <button onClick={togglePause} className={cx("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm", paused ? "bg-warn-soft text-warn" : "text-ink-2 hover:bg-surface-2")}>
              <span>{paused ? "Sending paused" : "Sending on"}</span>
              <span className="text-xs font-medium underline">{paused ? "Resume" : "Pause all"}</span>
            </button>
            <div className="flex items-center justify-between px-2.5 text-xs text-ink-3">
              <span className="truncate">{session.user.name}</span>
              <Badge tone={session.user.plan === "free" ? "neutral" : "brand"}>{session.user.plan}</Badge>
            </div>
          </div>
        </aside>
        {menuOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} />}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur md:px-8">
            <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 md:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
              ☰
            </button>
            <div className="flex-1" />
            {paused && <Badge tone="warn">Sending paused</Badge>}
            <div className="relative">
              <button className="relative rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Notifications" onClick={async () => {
                setShowNotes((v) => !v);
                if (notifications.data?.unread) {
                  await post("/notifications/read-all");
                  void notifications.reload();
                }
              }}>
                🔔
                {!!notifications.data?.unread && <span className="absolute right-1 top-1 size-2 rounded-full bg-bad" />}
              </button>
              {showNotes && (
                <div className="absolute right-0 top-11 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-xl">
                  <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">Notifications</p>
                  <ul className="max-h-96 overflow-y-auto">
                    {(notifications.data?.items ?? []).length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-3">Nothing yet</li>}
                    {(notifications.data?.items ?? []).map((n) => (
                      <li key={n.id} className="border-b border-border last:border-0">
                        <Link href={n.link ?? "#"} onClick={() => setShowNotes(false)} className="block px-4 py-3 hover:bg-surface-2">
                          <p className="text-sm font-medium text-ink">{n.title}</p>
                          {n.body && <p className="line-clamp-2 text-xs text-ink-3">{n.body}</p>}
                          <p className="mt-1 text-xs text-ink-3">{timeAgo(n.createdAt)}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={async () => { await post("/auth/logout"); router.push("/auth/signin"); }}>
              Sign out
            </Button>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </SessionCtx.Provider>
  );
}
