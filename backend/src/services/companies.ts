import { guessTimezone, normalizeCompany, type CompanySize } from "shared";
import { eq, ilike, or } from "drizzle-orm";
import { db, schema } from "db";

export type Company = typeof schema.companies.$inferSelect;

export function sizeFromTeam(teamSize?: number | null): CompanySize | null {
  if (teamSize == null) return null;
  if (teamSize <= 200) return "startup";
  if (teamSize <= 2000) return "scaleup";
  return "mnc";
}

/** Find a company by domain (preferred) or normalized name; create it if missing. */
export async function findOrCreateCompany(input: {
  name: string;
  domain?: string | null;
  website?: string | null;
  location?: string | null;
  teamSize?: number | null;
  industry?: string | null;
  description?: string | null;
  atsType?: string | null;
  atsToken?: string | null;
}): Promise<Company> {
  const domain = input.domain?.toLowerCase().replace(/^www\./, "") || null;
  if (domain) {
    const [byDomain] = await db.select().from(schema.companies).where(eq(schema.companies.domain, domain));
    if (byDomain) return byDomain;
  }
  const norm = normalizeCompany(input.name);
  const candidates = await db
    .select()
    .from(schema.companies)
    .where(or(ilike(schema.companies.name, input.name), ilike(schema.companies.name, `${input.name.split(/\s+/)[0]}%`)));
  const byName = candidates.find((c) => normalizeCompany(c.name) === norm);
  if (byName) {
    if (domain && !byName.domain) {
      const [updated] = await db.update(schema.companies).set({ domain, website: input.website ?? `https://${domain}` }).where(eq(schema.companies.id, byName.id)).returning();
      return updated;
    }
    return byName;
  }
  const [created] = await db
    .insert(schema.companies)
    .values({
      name: input.name,
      domain,
      website: input.website ?? (domain ? `https://${domain}` : null),
      location: input.location ?? null,
      timezone: input.location ? guessTimezone(input.location, "UTC") : null,
      teamSize: input.teamSize ?? null,
      size: sizeFromTeam(input.teamSize),
      industry: input.industry ?? null,
      description: input.description ?? null,
      atsType: input.atsType ?? null,
      atsToken: input.atsToken ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a race on the unique domain index
  const [existing] = await db.select().from(schema.companies).where(eq(schema.companies.domain, domain!));
  return existing;
}
