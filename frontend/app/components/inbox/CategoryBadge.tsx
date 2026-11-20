"use client";

import { Badge } from "@/app/components/ui";

export function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, { tone: "ok" | "bad" | "info" | "warn" | "neutral" | "brand"; label: string }> = {
    interested: { tone: "ok", label: "Interested" },
    asked_for_resume: { tone: "brand", label: "Asked for resume" },
    referral: { tone: "info", label: "Referral" },
    out_of_office: { tone: "neutral", label: "Out of office" },
    rejected: { tone: "bad", label: "Not now" },
    other: { tone: "neutral", label: "Reply" },
  };
  const m = map[category] ?? map.other;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
