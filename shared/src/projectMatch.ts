import { extractSkills, normalizeSkills, RELATED_SKILLS } from "./skills";
import type { Project } from "./types";

export interface ProjectMatch {
  project: Project;
  score: number;
  overlap: string[];
}

/** Rank the candidate's projects by relevance to a job description / company product. */
export function rankProjects(projects: Project[], targetText: string): ProjectMatch[] {
  const target = new Set(extractSkills(targetText));
  const targetWords = new Set(
    targetText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 4),
  );
  return projects
    .map((project) => {
      const tech = normalizeSkills([...project.technologies, ...extractSkills(`${project.name} ${project.description}`)]);
      const overlap = tech.filter((t) => target.has(t));
      const related = tech.filter((t) => !target.has(t) && (RELATED_SKILLS[t] ?? []).some((r) => target.has(r)));
      const words = `${project.name} ${project.description}`.toLowerCase().split(/[^a-z0-9]+/);
      const domainHits = new Set(words.filter((w) => w.length > 4 && targetWords.has(w))).size;
      const score = overlap.length * 3 + related.length + Math.min(domainHits, 6) * 0.75;
      return { project, score: Number(score.toFixed(2)), overlap };
    })
    .sort((a, b) => b.score - a.score);
}

export function bestProject(projects: Project[], targetText: string): ProjectMatch | null {
  const ranked = rankProjects(projects, targetText);
  return ranked[0] ?? null;
}
