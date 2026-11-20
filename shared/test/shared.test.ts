import { describe, expect, it } from "vitest";
import {
  abWinner,
  applyPattern,
  checkSpam,
  classifyReplyHeuristic,
  computeInsights,
  dedupeJobs,
  dedupeKey,
  detectPattern,
  detectScam,
  effectiveDailyLimit,
  extractSkills,
  finalEmailConfidence,
  generateCandidates,
  guessTimezone,
  inboxHealthScore,
  localParts,
  nextSendTime,
  parseResumeText,
  rankProjects,
  scoreJob,
  spreadSends,
  templateEmail,
  templateLinkedInNote,
  warmupLimit,
  type OutreachRecord,
  type ProfileForMatching,
} from "shared";

const profile: ProfileForMatching = {
  skills: ["Next.js", "TypeScript", "PostgreSQL", "Node.js", "Tailwind CSS"],
  targetRoles: ["frontend", "fullstack"],
  experienceLevel: "fresher",
  yearsExperience: 0,
  preferences: { workModes: ["remote"], cities: ["Bangalore"], companySizes: ["startup"], industries: ["fintech"], employmentTypes: ["internship"] },
  projects: [
    { name: "ShopSmart", description: "An e-commerce storefront with Stripe payments", technologies: ["Next.js", "PostgreSQL", "Stripe"] },
    { name: "ChatDocs", description: "RAG chatbot over PDFs using LLMs", technologies: ["Python", "LangChain", "pgvector"] },
  ],
};

describe("skills", () => {
  it("extracts canonical skills and avoids false positives from plain English", () => {
    const s = extractSkills("We use Next.js, React and Postgres. Experience with Go and Kubernetes is a plus. Let's go to the rest of the docs.");
    expect(s).toEqual(expect.arrayContaining(["Next.js", "React", "PostgreSQL", "Go", "Kubernetes"]));
    expect(s).not.toContain("REST");
    expect(extractSkills("we will go home and rest")).not.toContain("Go");
  });
});

describe("scoring", () => {
  it("scores a matching remote frontend internship highly with reasons", () => {
    const r = scoreJob(profile, {
      title: "Frontend Engineering Intern",
      company: "Acme",
      description: "Remote internship. You will build UIs with Next.js, TypeScript and Tailwind. Our API uses Node.js and PostgreSQL.",
      remote: true,
    });
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.join(" ")).toMatch(/Next\.js/);
    expect(r.matchedSkills).toEqual(expect.arrayContaining(["Next.js", "PostgreSQL"]));
  });

  it("scores a senior onsite Java role low for a fresher", () => {
    const r = scoreJob(profile, {
      title: "Senior Java Engineer",
      company: "BigCo",
      description: "Onsite in Berlin. 7+ years of experience with Java, Spring and Kafka. Full-time.",
      location: "Berlin",
    });
    expect(r.score).toBeLessThan(30);
  });
});

describe("dedupe", () => {
  it("collapses the same job across platforms", () => {
    expect(dedupeKey({ company: "Acme Inc.", title: "Sr. Frontend Developer (Remote)", location: "Remote" })).toBe(
      dedupeKey({ company: "acme", title: "Senior Front-end Engineer", location: "Anywhere" }),
    );
    const merged = dedupeJobs([
      { company: "Acme", title: "Backend Engineer", location: "NYC", url: "https://a", source: "greenhouse" },
      { company: "Acme, Inc", title: "Back-end Engineer", location: "NYC, NY", url: "https://b", source: "hn" },
      { company: "Acme", title: "Designer", location: "NYC", url: "https://c", source: "hn" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].sources).toHaveLength(2);
  });
});

describe("scam detection", () => {
  it("flags fee + telegram + gmail postings", () => {
    const r = detectScam({
      title: "Data Entry Intern",
      company: "Global Jobs",
      description: "Earn $500 per day! Pay a small registration fee to start. Contact HR on Telegram for interview. Email jobs.hr@gmail.com",
    });
    expect(r.level).toBe("high");
    expect(r.reasons.length).toBeGreaterThan(2);
  });
  it("passes a normal posting", () => {
    const r = detectScam({
      title: "Software Engineer",
      company: "Stripe",
      description: "Stripe is hiring a software engineer to work on our payments API. You will design, build and operate reliable distributed systems used by millions of businesses. Apply via our careers page.",
      url: "https://stripe.com/jobs/1",
    });
    expect(r.level).toBe("low");
  });
});

describe("spam checker", () => {
  it("flags spammy words and shouting", () => {
    const r = checkSpam("FREE GUARANTEED OFFER!!!", "Click here to act now. 100% risk-free.");
    expect(r.level).toBe("risky");
    expect(r.hits.map((h) => h.phrase)).toEqual(expect.arrayContaining(["free", "click here", "act now"]));
  });
  it("passes a clean cold email", () => {
    expect(checkSpam("Frontend intern who built ShopSmart", "Hi Sam,\n\nI built ShopSmart with Next.js. Open to a quick call?\n\nThanks").level).toBe("good");
  });
});

describe("email patterns", () => {
  it("detects f.lastname style patterns from examples", () => {
    const d = detectPattern(
      [
        { email: "j.doe@acme.io", name: "Jane Doe" },
        { email: "a.smith@acme.io", name: "Alan Smith" },
        { email: "r.kumar@acme.io", name: "Ravi Kumar" },
      ],
      "acme.io",
    );
    expect(d.pattern).toBe("{f}.{last}");
    expect(d.confidence).toBeGreaterThan(0.7);
    const c = generateCandidates("Priya Sharma", "acme.io", d);
    expect(c[0].email).toBe("p.sharma@acme.io");
    expect(c[0].confidence).toBeGreaterThan(80);
  });
  it("applies patterns and handles accents", () => {
    expect(applyPattern("{first}.{last}", "José", "Núñez", "x.com")).toBe("jose.nunez@x.com");
    expect(applyPattern("{first}.{last}", "Cher", "", "x.com")).toBeNull();
  });
  it("combines verification into a confidence score", () => {
    expect(finalEmailConfidence(60, "valid", true)).toBeGreaterThanOrEqual(90);
    expect(finalEmailConfidence(60, "invalid", true)).toBe(0);
    expect(finalEmailConfidence(60, "unknown", false)).toBe(0);
  });
});

describe("timezone scheduling", () => {
  it("maps locations to zones", () => {
    expect(guessTimezone("San Francisco, CA")).toBe("America/Los_Angeles");
    expect(guessTimezone("Bengaluru, India")).toBe("Asia/Kolkata");
    expect(guessTimezone("Mars")).toBe("UTC");
  });
  it("schedules at 10 AM recipient time on a weekday", () => {
    // Friday 2026-11-20 20:00 UTC = 12:00 PST, so the next 10 AM weekday slot is Monday
    const t = nextSendTime("America/Los_Angeles", new Date("2026-11-20T20:00:00Z"), { startHour: 9, endHour: 17, weekdaysOnly: true, preferredHour: 10 }, 0);
    const lp = localParts("America/Los_Angeles", t);
    // Still inside the window on Friday, so it sends shortly after
    expect(lp.weekday).toBe(5);
    const t2 = nextSendTime("America/Los_Angeles", new Date("2026-11-21T02:00:00Z"), { startHour: 9, endHour: 17, weekdaysOnly: true, preferredHour: 10 }, 0);
    const lp2 = localParts("America/Los_Angeles", t2);
    expect(lp2.weekday).toBe(1);
    expect(lp2.hour).toBe(10);
  });
});

describe("sending safety", () => {
  it("ramps warm-up and respects limits", () => {
    expect(warmupLimit(0, 50)).toBe(5);
    expect(warmupLimit(30, 50)).toBe(50);
    const now = new Date("2026-11-20T00:00:00Z");
    expect(effectiveDailyLimit({ planLimit: 80, accountLimit: 50, warmupEnabled: true, warmupStartedAt: new Date("2026-11-18T00:00:00Z"), now })).toBe(7);
    expect(effectiveDailyLimit({ planLimit: 80, accountLimit: 50, warmupEnabled: false, now, healthScore: 30 })).toBe(5);
  });
  it("spreads sends with random gaps", () => {
    const times = spreadSends(new Date(0), 4, 60, 120, () => 0.5);
    expect(times.map((t) => t.getTime() / 1000)).toEqual([0, 90, 180, 270]);
  });
  it("scores inbox health", () => {
    expect(inboxHealthScore({ sent: 100, bounced: 10, replies: 1, spfOk: false }).score).toBeLessThan(60);
    expect(inboxHealthScore({ sent: 100, bounced: 1, replies: 12, spfOk: true, dkimOk: true, dmarcOk: true }).score).toBe(100);
  });
});

describe("reply classification", () => {
  const cases: [string, string, string][] = [
    ["Re: Intern", "Thanks for reaching out! Would love to chat. What's your availability next week?", "interested"],
    ["Re: Intern", "Unfortunately we are not hiring interns right now. Best of luck.", "rejected"],
    ["Automatic reply: Out of office", "I am out of the office until Monday with limited access to email.", "out_of_office"],
    ["Re: Intern", "Could you send over your resume? Happy to take a look.", "asked_for_resume"],
    ["Re: Intern", "I'm not the right person, but please reach out to maria@acme.io who runs hiring.", "referral"],
  ];
  it.each(cases)("%s / %s → %s", (subject, body, expected) => {
    expect(classifyReplyHeuristic(subject, body).category).toBe(expected);
  });
  it("ignores quoted history", () => {
    const r = classifyReplyHeuristic("Re: x", "Sounds great, let's chat!\n\nOn Tue, Jan 2, 2026 at 10:00 AM Bob wrote:\n> unfortunately not hiring");
    expect(r.category).toBe("interested");
    expect(r.asksForAvailability).toBe(false);
  });
});

describe("projects and templates", () => {
  it("picks the best project for a job", () => {
    const ranked = rankProjects(profile.projects, "We build an AI assistant with LLMs and RAG over documents");
    expect(ranked[0].project.name).toBe("ChatDocs");
  });
  it("writes a template email mentioning the matching project", () => {
    const d = templateEmail({
      sender: { name: "Asha", skills: profile.skills, projects: profile.projects, links: { github: "https://github.com/asha" }, experienceLevel: "fresher" },
      recipient: { name: "Sam Lee", title: "CTO" },
      company: { name: "PayFast", product: "checkout for online stores", techStack: ["Next.js", "PostgreSQL"] },
      job: { title: "Frontend Intern" },
      tone: "casual",
    });
    expect(d.body).toContain("Hi Sam");
    expect(d.body).toContain("ShopSmart");
    expect(d.subjects.length).toBeGreaterThanOrEqual(3);
    expect(checkSpam(d.subject, d.body).level).not.toBe("risky");
    const note = templateLinkedInNote({
      sender: { name: "Asha", skills: [], projects: profile.projects, links: {}, experienceLevel: "fresher" },
      recipient: { name: "Sam Lee" },
      company: { name: "PayFast" },
      tone: "casual",
    });
    expect(note.length).toBeLessThanOrEqual(300);
  });
});

describe("resume parsing", () => {
  it("extracts sections from plain resume text", () => {
    const text = `Asha Verma
Full Stack Developer
asha@example.com | +91 98765 43210 | github.com/ashav | linkedin.com/in/asha-verma

SKILLS
Languages: TypeScript, JavaScript, Python
Frameworks: Next.js, React, Node.js, Express, Tailwind CSS
Databases: PostgreSQL, Redis

EXPERIENCE
Software Engineer Intern | Razorpay | Jan 2025 - Jun 2025
• Built dashboards in React and TypeScript
• Reduced API latency by 30% with Redis caching

Software Engineer, Zeta, Jul 2023 - Present
• Payments APIs in Node.js and PostgreSQL

PROJECTS
ShopSmart | Next.js, PostgreSQL, Stripe
• E-commerce storefront with payments and admin panel
ChatDocs - Python, LangChain
• RAG chatbot over PDFs

EDUCATION
National Institute of Technology, Trichy
B.Tech in Computer Science, 2019 - 2023, CGPA: 8.7/10
`;
    const r = parseResumeText(text);
    expect(r.name).toBe("Asha Verma");
    expect(r.email).toBe("asha@example.com");
    expect(r.links.github).toBe("https://github.com/ashav");
    expect(r.skills).toEqual(expect.arrayContaining(["TypeScript", "Next.js", "PostgreSQL", "Redis"]));
    expect(r.experience).toHaveLength(2);
    expect(r.experience[0].company).toBe("Razorpay");
    expect(r.projects.map((p) => p.name)).toEqual(["ShopSmart", "ChatDocs"]);
    expect(r.education[0].institution).toMatch(/National Institute of Technology/);
    expect(r.yearsExperience).toBeGreaterThan(2);
  });
});

describe("analytics", () => {
  it("finds that startups reply more than MNCs", () => {
    const recs: OutreachRecord[] = [];
    const mk = (companySize: string, replied: boolean, i: number): OutreachRecord => ({
      sentAt: new Date(Date.UTC(2026, 0, 1, 15)), opened: true, replied, positive: replied, bounced: false,
      templateKey: "t", subject: i % 2 ? "A" : "B", tone: "casual", role: "frontend", companySize, contactRole: "founder", step: 0,
    });
    for (let i = 0; i < 20; i++) recs.push(mk("startup", i < 6, i));
    for (let i = 0; i < 20; i++) recs.push(mk("mnc", i < 2, i));
    const ins = computeInsights(recs);
    expect(ins.some((x) => /Startups reply 3\.0× more than MNCs/.test(x.text))).toBe(true);
  });
  it("picks A/B winners only with significance", () => {
    expect(abWinner({ sent: 100, replies: 20 }, { sent: 100, replies: 5 })).toBe("A");
    expect(abWinner({ sent: 10, replies: 5 }, { sent: 10, replies: 1 })).toBeNull();
  });
});
