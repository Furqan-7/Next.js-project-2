import { bestProject } from "./projectMatch";
import { humanList } from "./scoring";
import type { Project, Tone } from "./types";

export interface EmailContext {
  sender: { name: string; headline?: string; skills: string[]; projects: Project[]; links: { github?: string; portfolio?: string; linkedin?: string }; experienceLevel: string; college?: string };
  recipient: { name: string; firstName?: string; title?: string; role?: string; recentPosts?: { title: string; url?: string }[] };
  company: { name: string; product?: string; techStack?: string[]; recentNews?: string[] };
  job?: { title: string; description?: string; url?: string };
  tone: Tone;
  step?: number; // 0 initial, 1.. follow-ups
  resumeUrl?: string;
}

export interface DraftEmail {
  subject: string;
  subjects: string[];
  body: string;
  projectUsed?: string;
}

function first(name: string, fallback?: string) {
  return fallback || name.split(/\s+/)[0] || "there";
}

/** Deterministic writer used without an LLM key (and in tests). Keeps emails short and specific. */
export function templateEmail(ctx: EmailContext): DraftEmail {
  const fn = first(ctx.recipient.name, ctx.recipient.firstName);
  const target = `${ctx.job?.title ?? ""} ${ctx.job?.description ?? ""} ${ctx.company.product ?? ""} ${(ctx.company.techStack ?? []).join(" ")}`;
  const match = bestProject(ctx.sender.projects, target);
  const project = match?.project;
  const overlap = match?.overlap.length ? match.overlap : ctx.sender.skills.filter((s) => (ctx.company.techStack ?? []).includes(s)).slice(0, 3);
  const role = ctx.job?.title ?? (ctx.sender.experienceLevel === "fresher" ? "an internship or junior role" : "an engineering role");
  const hook = ctx.recipient.recentPosts?.[0]
    ? `I read your post "${ctx.recipient.recentPosts[0].title}"`
    : ctx.company.recentNews?.[0]
      ? `Congrats on ${ctx.company.recentNews[0].replace(/\.$/, "")}`
      : ctx.company.product
        ? `I've been looking at ${ctx.company.name}'s ${ctx.company.product}`
        : `I've been following ${ctx.company.name}`;
  const projectLine = project
    ? `I built ${project.name}${project.description ? `, ${lowerFirst(project.description.split(/[.!]/)[0].trim())}` : ""}${overlap.length ? ` using ${humanList(overlap.slice(0, 3))}` : ""}${ctx.company.product ? `, which is close to what you're doing with ${ctx.company.product}` : ""}.`
    : `I work mostly with ${humanList(ctx.sender.skills.slice(0, 4))}.`;
  const links = [ctx.sender.links.portfolio, ctx.sender.links.github].filter(Boolean) as string[];
  const linkLine = ctx.resumeUrl ? `Resume: ${ctx.resumeUrl}` : links.length ? `Work: ${links[0]}` : "";

  if ((ctx.step ?? 0) > 0) {
    const followups = [
      `Hi ${fn},\n\nBumping this in case it got buried. I'd still love to help with ${role} at ${ctx.company.name}. Happy to do a small take-home or paid trial task if that's easier.\n\n${ctx.sender.name}`,
      `Hi ${fn},\n\nOne more idea: ${project ? `I could walk you through ${project.name} in 15 minutes` : "I could share a quick demo of my recent work"}. If timing isn't right, no worries at all.\n\n${ctx.sender.name}`,
      `Hi ${fn},\n\nI'll stop here so I don't crowd your inbox. If ${role} opens up later at ${ctx.company.name}, I'd love to be considered.\n\nThanks,\n${ctx.sender.name}`,
    ];
    const body = followups[Math.min(ctx.step! - 1, followups.length - 1)];
    return { subject: `Re: ${role} at ${ctx.company.name}`, subjects: [`Re: ${role} at ${ctx.company.name}`], body, projectUsed: project?.name };
  }

  let body: string;
  if (ctx.tone === "formal") {
    body = `Dear ${fn},\n\n${hook}, and I'm writing to express interest in ${role} at ${ctx.company.name}.\n\n${projectLine}\n\nI would welcome the chance to discuss how I could contribute. ${linkLine}\n\nKind regards,\n${ctx.sender.name}`;
  } else if (ctx.tone === "founder") {
    body = `Hey ${fn},\n\n${hook}. I'm a builder too: ${projectLine.charAt(0).toLowerCase()}${projectLine.slice(1)}\n\nI'd love to help ${ctx.company.name} ship faster as ${/^an? /.test(role) ? role : `your ${role}`}. Worth a 15-min chat this week?\n\n${linkLine}\n\n${ctx.sender.name}`;
  } else {
    body = `Hi ${fn},\n\n${hook}. ${projectLine}\n\nI'd love to be considered for ${role} at ${ctx.company.name}. Open to a quick call?\n\n${linkLine}\n\nThanks,\n${ctx.sender.name}`;
  }
  body = body.replace(/\n{3,}/g, "\n\n").replace(/ \n/g, "\n");

  const subjects = [
    `${ctx.sender.experienceLevel === "fresher" ? "Intern" : "Engineer"} who built ${project?.name ?? "something relevant"}`,
    `${role} at ${ctx.company.name}`,
    `Quick question about ${ctx.company.name}'s ${ctx.company.product ?? "team"}`,
    overlap.length ? `${humanList(overlap.slice(0, 2))} dev for ${ctx.company.name}?` : `Can I help ${ctx.company.name}?`,
    `${fn}, idea for ${ctx.company.name}`,
  ].map((s) => s.slice(0, 70));
  return { subject: subjects[0], subjects, body, projectUsed: project?.name };
}

function lowerFirst(s: string) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** LinkedIn connection notes are capped at 300 characters. */
export function templateLinkedInNote(ctx: EmailContext): string {
  const fn = first(ctx.recipient.name, ctx.recipient.firstName);
  const match = bestProject(ctx.sender.projects, `${ctx.job?.title ?? ""} ${ctx.company.product ?? ""} ${(ctx.company.techStack ?? []).join(" ")}`);
  const note = `Hi ${fn}, I'm ${ctx.sender.name}${ctx.sender.headline ? `, ${ctx.sender.headline}` : ""}. ${match ? `I built ${match.project.name}, related to what ${ctx.company.name} does.` : `I admire what ${ctx.company.name} is building.`} Would love to connect${ctx.job ? ` about the ${ctx.job.title} role` : ""}!`;
  return note.length <= 300 ? note : `${note.slice(0, 297)}...`;
}

export function templateCoverLetter(ctx: EmailContext): string {
  const match = bestProject(ctx.sender.projects, `${ctx.job?.title ?? ""} ${ctx.job?.description ?? ""}`);
  const skills = humanList(ctx.sender.skills.slice(0, 6));
  return [
    `Dear Hiring Team at ${ctx.company.name},`,
    ``,
    `I'm applying for the ${ctx.job?.title ?? "open engineering"} position. I work with ${skills}${ctx.sender.college ? ` and studied at ${ctx.sender.college}` : ""}.`,
    ``,
    match
      ? `Most relevant is ${match.project.name}: ${match.project.description} It used ${humanList(match.project.technologies.slice(0, 4))}, which lines up with this role.`
      : `I've shipped several projects end to end, from design to deployment.`,
    ``,
    `I'm drawn to ${ctx.company.name}${ctx.company.product ? ` because of ${ctx.company.product}` : ""}, and I'd bring ownership, fast iteration and clear communication to the team.`,
    ``,
    `Thank you for your time. I'd welcome the chance to talk.`,
    ``,
    `Sincerely,`,
    ctx.sender.name,
  ].join("\n");
}
