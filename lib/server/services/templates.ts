import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { EDITOR_STARTER_TEMPLATE } from "@/lib/editor-template";
import type { AnalysisTemplate } from "@/lib/integrity/features";
import { recordAudit } from "@/lib/server/audit";
import type { Db, Tx } from "@/lib/server/db";
import { approvedSnippet, contest, userTemplate, userTemplateVersion } from "@/lib/server/db/schema";
import { AppError, forbidden, notFound } from "@/lib/server/errors";
import { isUuid } from "@/lib/validation/ids";
import { snippetInputSchema, templateInputSchema, templateVersionSchema } from "@/lib/validation/templates";
import { canManageContest } from "./policy";
import type { Principal } from "./roles";
import { sha256Hex } from "./submissions";

type Clock = { now?: Date };
export const MAX_TEMPLATES_PER_USER = 50;

// ---------------------------------------------------------------- personal templates

/**
 * The viewer's templates with their latest version. Versions are append-only
 * and server-timestamped; for any contest the version in effect is the
 * latest one saved before that contest started.
 */
export async function listOwnTemplates(db: Db, viewer: Principal) {
  const templates = await db.select().from(userTemplate).where(eq(userTemplate.userId, viewer.userId)).orderBy(asc(userTemplate.createdAt));
  if (templates.length === 0) return [];
  const versions = await db
    .select({ id: userTemplateVersion.id, templateId: userTemplateVersion.templateId, source: userTemplateVersion.source, sourceSha256: userTemplateVersion.sourceSha256, createdAt: userTemplateVersion.createdAt })
    .from(userTemplateVersion)
    .where(inArray(userTemplateVersion.templateId, templates.map((t) => t.id)))
    .orderBy(desc(userTemplateVersion.createdAt));
  return templates.map((t) => {
    const vs = versions.filter((v) => v.templateId === t.id);
    return { ...t, latest: vs[0] ?? null, versionCount: vs.length, history: vs.map(({ id, sourceSha256, createdAt }) => ({ id, sourceSha256, createdAt })) };
  });
}

async function lockOwnTemplate(tx: Tx, viewer: Principal, templateId: string) {
  if (!isUuid(templateId)) throw notFound("Template");
  const [t] = await tx.select().from(userTemplate).where(eq(userTemplate.id, templateId)).for("update");
  if (!t || t.userId !== viewer.userId) throw notFound("Template");
  if (t.archivedAt) throw new AppError("CONFLICT", "This template is archived", 409);
  return t;
}

export async function createTemplate(db: Db, viewer: Principal, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = templateInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const count = await tx.$count(userTemplate, and(eq(userTemplate.userId, viewer.userId), isNull(userTemplate.archivedAt)));
    if (count >= MAX_TEMPLATES_PER_USER) throw new AppError("CONFLICT", `At most ${MAX_TEMPLATES_PER_USER} templates`, 409);
    const [t] = await tx.insert(userTemplate).values({ userId: viewer.userId, name: input.name, createdAt: now }).returning({ id: userTemplate.id });
    await tx.insert(userTemplateVersion).values({ templateId: t!.id, source: input.source, sourceSha256: sha256Hex(input.source), createdAt: now });
    return { id: t!.id };
  });
}

/** Saves a new version. Identical content to the latest version is a no-op. */
export async function saveTemplateVersion(db: Db, viewer: Principal, templateId: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = templateVersionSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockOwnTemplate(tx, viewer, templateId);
    const hash = sha256Hex(input.source);
    const [latest] = await tx
      .select({ sha: userTemplateVersion.sourceSha256 })
      .from(userTemplateVersion)
      .where(eq(userTemplateVersion.templateId, templateId))
      .orderBy(desc(userTemplateVersion.createdAt))
      .limit(1);
    if (latest?.sha === hash) return { created: false };
    await tx.insert(userTemplateVersion).values({ templateId, source: input.source, sourceSha256: hash, createdAt: now });
    return { created: true };
  });
}

export async function archiveTemplate(db: Db, viewer: Principal, templateId: string, { now = new Date() }: Clock = {}) {
  await db.transaction(async (tx) => {
    await lockOwnTemplate(tx, viewer, templateId);
    await tx.update(userTemplate).set({ archivedAt: now }).where(eq(userTemplate.id, templateId));
  });
}

/**
 * Templates frozen for a contest: per template, the latest version created
 * strictly before the contest started, excluding templates archived before it.
 */
export async function frozenTemplatesFor(db: Db | Tx, userId: string, contestStartsAt: Date): Promise<AnalysisTemplate[]> {
  const templates = await db
    .select({ id: userTemplate.id, name: userTemplate.name })
    .from(userTemplate)
    .where(and(eq(userTemplate.userId, userId), or(isNull(userTemplate.archivedAt), gt(userTemplate.archivedAt, contestStartsAt))));
  if (templates.length === 0) return [];
  const versions = await db
    .select({ templateId: userTemplateVersion.templateId, source: userTemplateVersion.source, sourceSha256: userTemplateVersion.sourceSha256, createdAt: userTemplateVersion.createdAt })
    .from(userTemplateVersion)
    .where(and(inArray(userTemplateVersion.templateId, templates.map((t) => t.id)), lt(userTemplateVersion.createdAt, contestStartsAt)))
    .orderBy(desc(userTemplateVersion.createdAt));
  const out: AnalysisTemplate[] = [];
  for (const t of templates) {
    const v = versions.find((x) => x.templateId === t.id);
    if (v) out.push({ kind: "personal", name: t.name, source: v.source, sourceSha256: v.sourceSha256 });
  }
  return out;
}

// ---------------------------------------------------------------- approved snippets

async function managedContest(db: Db | Tx, viewer: Principal, contestId: string) {
  if (!isUuid(contestId)) throw notFound("Contest");
  const [c] = await db.select().from(contest).where(eq(contest.id, contestId));
  if (!c) throw notFound("Contest");
  if (!canManageContest(viewer, c)) throw forbidden();
  return c;
}

export async function listSnippets(db: Db, viewer: Principal, contestId: string) {
  await managedContest(db, viewer, contestId);
  return db.select().from(approvedSnippet).where(eq(approvedSnippet.contestId, contestId)).orderBy(asc(approvedSnippet.createdAt));
}

export async function addSnippet(db: Db, viewer: Principal, contestId: string, raw: unknown, { now = new Date() }: Clock = {}) {
  const input = snippetInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    await managedContest(tx, viewer, contestId);
    const [s] = await tx
      .insert(approvedSnippet)
      .values({ contestId, name: input.name, source: input.source, sourceSha256: sha256Hex(input.source), createdBy: viewer.userId, createdAt: now })
      .returning({ id: approvedSnippet.id });
    await recordAudit(tx, { actorId: viewer.userId, action: "contest.snippet.add", targetType: "contest", targetId: contestId, metadata: { snippetId: s!.id, name: input.name } });
    return { id: s!.id };
  });
}

export async function retireSnippet(db: Db, viewer: Principal, contestId: string, snippetId: string, { now = new Date() }: Clock = {}) {
  if (!isUuid(snippetId)) throw notFound("Snippet");
  await db.transaction(async (tx) => {
    await managedContest(tx, viewer, contestId);
    const updated = await tx
      .update(approvedSnippet)
      .set({ retiredAt: now })
      .where(and(eq(approvedSnippet.id, snippetId), eq(approvedSnippet.contestId, contestId), isNull(approvedSnippet.retiredAt)))
      .returning({ id: approvedSnippet.id });
    if (updated.length === 0) throw notFound("Snippet");
    await recordAudit(tx, { actorId: viewer.userId, action: "contest.snippet.retire", targetType: "contest", targetId: contestId, metadata: { snippetId } });
  });
}

/** Snippets in effect at `at`, plus the editor's starter template (always approved). */
export async function snippetsInEffect(db: Db | Tx, contestId: string, at: Date): Promise<AnalysisTemplate[]> {
  const rows = await db
    .select()
    .from(approvedSnippet)
    .where(and(eq(approvedSnippet.contestId, contestId), lt(approvedSnippet.createdAt, at), or(isNull(approvedSnippet.retiredAt), gt(approvedSnippet.retiredAt, at))));
  return [
    { kind: "starter", name: "Editor starter code", source: EDITOR_STARTER_TEMPLATE, sourceSha256: sha256Hex(EDITOR_STARTER_TEMPLATE) },
    ...rows.map((r) => ({ kind: "snippet" as const, name: r.name, source: r.source, sourceSha256: r.sourceSha256 })),
  ];
}
