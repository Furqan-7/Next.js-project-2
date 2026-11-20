"use client";

import { COMPANY_SIZES, EMPLOYMENT_TYPES, TARGET_ROLES, WORK_MODES, type CompanySize, type EmploymentType, type TargetRole, type WorkMode } from "shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage, post, put } from "@/app/services/api";
import type { Profile, User } from "@/app/types/api";
import { Badge, Button, Card, Chips, cx, ErrorNote, Input, Loading, Select, TagInput, Textarea, useToast } from "@/app/components/ui";

const STEPS = ["Resume", "Links", "Experience", "Preferences", "Your voice"] as const;
const ROLE_LABELS: Partial<Record<TargetRole, string>> = { sde: "SDE", ai_engineer: "AI engineer", ml_engineer: "ML engineer", data_engineer: "Data engineer", fullstack: "Full-stack" };
const ET_LABELS: Record<EmploymentType, string> = { internship: "Internship", full_time: "Full-time", freelance: "Freelance", contract: "Contract" };
const SIZE_LABELS: Record<CompanySize, string> = { startup: "Startup", scaleup: "Scale-up", mnc: "MNC / Big tech" };

export default function Onboarding() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [p, setP] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [links, setLinks] = useState({ github: "", portfolio: "", linkedin: "" });

  useEffect(() => {
    api<{ user: User; profile: Profile }>("/auth/me").then(({ user, profile }) => {
      setUser(user);
      setP(profile);
      setLinks({ github: profile.links.github ?? "", portfolio: profile.links.portfolio ?? "", linkedin: profile.links.linkedin ?? "" });
    });
  }, []);

  if (!p || !user) return <Loading />;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const setPref = <K extends keyof Profile["preferences"]>(k: K, v: Profile["preferences"][K]) => setP({ ...p, preferences: { ...p.preferences, [k]: v } });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadResume = (file?: File) =>
    run(async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      else fd.append("text", resumeText);
      const r = await api<{ profile: Profile; source: string }>("/profile/resume", { method: "POST", body: fd });
      setP(r.profile);
      setLinks({ github: r.profile.links.github ?? "", portfolio: r.profile.links.portfolio ?? "", linkedin: r.profile.links.linkedin ?? "" });
      toast(`Found ${r.profile.skills.length} skills and ${r.profile.projects.length} projects`);
    });

  const saveAndNext = () =>
    run(async () => {
      if (step === 1 && (links.github || links.portfolio || links.linkedin)) {
        const r = await post<{ profile: Profile; errors: string[] }>("/profile/enrich", Object.fromEntries(Object.entries(links).filter(([, v]) => v)));
        setP(r.profile);
        r.errors.forEach((e) => toast(e, "bad"));
      } else {
        const { profile } = await put<{ profile: Profile }>("/profile", {
          headline: p.headline ?? undefined,
          experienceLevel: p.experienceLevel,
          yearsExperience: p.yearsExperience,
          targetRoles: p.targetRoles,
          skills: p.skills,
          preferences: p.preferences,
          writingSample: p.writingSample || undefined,
          college: p.college ?? undefined,
          publicVisible: p.publicVisible,
        });
        setP(profile);
      }
      if (step === STEPS.length - 1) {
        await post("/profile/complete-onboarding");
        router.push("/dashboard");
      } else setStep(step + 1);
    });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand font-bold text-brand-ink">J</span>
        <span className="font-semibold">Set up your job search</span>
      </div>
      <ol className="mb-6 flex gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cx("h-1.5 rounded-full", i <= step ? "bg-brand" : "bg-border")} />
            <p className={cx("mt-1.5 hidden text-xs sm:block", i === step ? "font-medium text-ink" : "text-ink-3")}>{s}</p>
          </li>
        ))}
      </ol>

      <Card className="p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Upload your resume</h2>
              <p className="text-sm text-ink-3">PDF. We pull out your skills, projects, experience and education. LinkedIn&apos;s &quot;Save to PDF&quot; export works too.</p>
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface-2 px-6 py-10 text-center hover:border-brand">
              <span className="text-sm font-medium">{p.resumeFileName ? `Uploaded: ${p.resumeFileName}` : "Choose a PDF"}</span>
              <span className="text-xs text-ink-3">Up to 8 MB</span>
              <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadResume(e.target.files[0])} />
            </label>
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-2">Or paste resume text</summary>
              <div className="mt-3 space-y-2">
                <Textarea rows={6} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume…" />
                <Button variant="secondary" size="sm" disabled={!resumeText.trim()} loading={busy} onClick={() => uploadResume()}>
                  Parse text
                </Button>
              </div>
            </details>
            {(p.skills.length > 0 || p.projects.length > 0) && (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <div>
                  <p className="mb-2 text-sm font-medium">Skills</p>
                  <TagInput value={p.skills} onChange={(v) => set("skills", v)} placeholder="Add a skill" />
                </div>
                {p.projects.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Projects</p>
                    <ul className="space-y-2">
                      {p.projects.map((pr) => (
                        <li key={pr.name} className="text-sm">
                          <span className="font-medium">{pr.name}</span> <span className="text-ink-3">· {pr.technologies.slice(0, 4).join(", ")}</span>
                          {pr.description && <p className="text-ink-3">{pr.description}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.education[0] && <p className="text-sm text-ink-2">🎓 {p.education[0].institution}</p>}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Connect your work</h2>
              <p className="text-sm text-ink-3">We read your public GitHub repos and portfolio to find more projects and skills.</p>
            </div>
            <Input label="GitHub" placeholder="https://github.com/you" value={links.github} onChange={(e) => setLinks({ ...links, github: e.target.value })} />
            <Input label="Portfolio" placeholder="https://you.dev" value={links.portfolio} onChange={(e) => setLinks({ ...links, portfolio: e.target.value })} />
            <Input label="LinkedIn" placeholder="https://linkedin.com/in/you" value={links.linkedin} onChange={(e) => setLinks({ ...links, linkedin: e.target.value })} hint="Saved as a link. LinkedIn doesn't allow profile reading, so upload its PDF export in step 1 if you want those details." />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Where are you in your career?</h2>
            <Chips options={["fresher", "experienced"] as const} value={[p.experienceLevel]} onChange={(v) => v.length && set("experienceLevel", v[v.length - 1])} labels={{ fresher: "Fresher / student", experienced: "Experienced" }} />
            {p.experienceLevel === "experienced" && (
              <Input label="Years of experience" type="number" min={0} max={50} step={0.5} value={p.yearsExperience} onChange={(e) => set("yearsExperience", Number(e.target.value))} />
            )}
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Roles you want</p>
              <Chips options={TARGET_ROLES} value={p.targetRoles as TargetRole[]} onChange={(v) => set("targetRoles", v)} labels={ROLE_LABELS} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Type of work</p>
              <Chips options={EMPLOYMENT_TYPES} value={p.preferences.employmentTypes} onChange={(v) => setPref("employmentTypes", v)} labels={ET_LABELS} />
            </div>
            <Input label="Headline" placeholder="Full-stack developer (Next.js, Node.js)" value={p.headline ?? ""} onChange={(e) => set("headline", e.target.value)} />
            <Input label="College" value={p.college ?? ""} onChange={(e) => set("college", e.target.value)} hint="Used to find alumni at companies for referrals" />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Preferences</h2>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Work mode</p>
              <Chips options={WORK_MODES} value={p.preferences.workModes as WorkMode[]} onChange={(v) => setPref("workModes", v)} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Cities</p>
              <TagInput value={p.preferences.cities} onChange={(v) => setPref("cities", v)} placeholder="Bangalore, Pune, Berlin…" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label={p.preferences.employmentTypes.includes("internship") ? "Expected stipend" : "Expected CTC"}
                type="number"
                min={0}
                value={p.preferences.expectedComp?.min ?? ""}
                onChange={(e) => setPref("expectedComp", { currency: p.preferences.expectedComp?.currency ?? "INR", period: p.preferences.expectedComp?.period ?? "month", min: e.target.value ? Number(e.target.value) : undefined })}
              />
              <Select label="Currency" value={p.preferences.expectedComp?.currency ?? "INR"} onChange={(e) => setPref("expectedComp", { ...(p.preferences.expectedComp ?? { period: "month" }), currency: e.target.value } as never)}>
                {["INR", "USD", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}
              </Select>
              <Select label="Per" value={p.preferences.expectedComp?.period ?? "month"} onChange={(e) => setPref("expectedComp", { ...(p.preferences.expectedComp ?? { currency: "INR" }), period: e.target.value as "month" | "year" } as never)}>
                <option value="month">month</option>
                <option value="year">year</option>
              </Select>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Company size</p>
              <Chips options={COMPANY_SIZES} value={p.preferences.companySizes} onChange={(v) => setPref("companySizes", v)} labels={SIZE_LABELS} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2">Industries</p>
              <TagInput value={p.preferences.industries} onChange={(v) => setPref("industries", v)} placeholder="fintech, AI, devtools…" />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">How do you write?</h2>
              <p className="text-sm text-ink-3">Paste an email or message you wrote. Drafts will match your greeting, rhythm and sign-off.</p>
            </div>
            <Textarea rows={8} value={p.writingSample ?? ""} onChange={(e) => set("writingSample", e.target.value)} placeholder={"Hi Priya,\n\nThanks for the quick reply! …\n\nCheers,\nAsha"} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={p.publicVisible} onChange={(e) => set("publicVisible", e.target.checked)} />
              Make my profile page public (a link you can put in emails and your bio)
            </label>
            {p.publicVisible && user.publicSlug && <Badge tone="brand">/p/{user.publicSlug}</Badge>}
          </div>
        )}

        {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <Button loading={busy} onClick={saveAndNext} disabled={step === 0 && p.skills.length === 0 && !p.resumeFileName}>
            {step === STEPS.length - 1 ? "Finish and see my matches" : "Continue"}
          </Button>
        </div>
      </Card>
      {step === 0 && (
        <p className="mt-3 text-center text-xs text-ink-3">
          No resume handy? <button className="underline" onClick={() => setStep(2)}>Skip and add skills later</button>
        </p>
      )}
    </div>
  );
}
