import type {
  ArticleByIdInput,
  ArticleDetail,
  ArticleImportError,
  ArticleImportResult,
  ArticleImportRow,
  ArticleListInput,
  ArticleListItem,
  CreateArticleInput,
  Page,
  UpdateArticleInput,
} from "@leoni/contracts";
import { ARTICLE_IMPORT_COLUMNS, articleImportRowSchema } from "@leoni/contracts";
import {
  ABC_CLASSES,
  type AbcClass,
  BusinessRuleError,
  type ClassParameters,
  computeLegacyThresholds,
  daysOfCoverage,
  defaultParametersForClass,
  NotFoundError,
} from "@leoni/core";

import type { Actor } from "../../context";
import { assertCanAccessSite, resolveSiteFilter } from "../../middlewares/site-scope";
import type { AuditEntry, AuditPayload } from "../../shared/audit";
import { parseCsv } from "../../shared/csv";
import { runRecalculation } from "../parameter/parameter.service";
import * as mapper from "./article.mapper";
import type { ArticleRepository, StockItemRow } from "./article.repository";
import { articleRepository } from "./article.repository";

/**
 * Business rules for the article module.
 *
 * The service is where a request becomes a decision: it resolves what the actor
 * is allowed to see, asks the repository for rows, and hands them to the domain
 * layer to be interpreted. It contains no SQL and no HTTP.
 *
 * Each entry point takes a parameter object whose `repository` defaults to the
 * Prisma-backed one. That is the seam the unit tests use: the rules below —
 * which site an actor really gets, where the extra page row goes, how a null
 * coverage sorts — are decisions worth testing, and they should not need a
 * database to exercise. The router never passes it.
 */

const MOVEMENT_HISTORY_LIMIT = 25;
const THRESHOLD_HISTORY_LIMIT = 30;

/**
 * Loads the tuning parameters for every ABC class once per request.
 *
 * The alternative — looking them up per article — would issue one query per row
 * on a 150-row page. There are exactly three classes, so they are fetched once
 * and shared.
 *
 * A class with no row falls back to `DEFAULT_CLASS_PARAMETERS`, which is the
 * only place those defaults are written. The map is total over `ABC_CLASSES`,
 * so callers index it without a fallback of their own — three call sites
 * previously each carried one, and one of them disagreed with the other two.
 */
async function loadParametersByClass(
  repository: ArticleRepository,
): Promise<ReadonlyMap<AbcClass, ClassParameters>> {
  const parameters = await Promise.all(
    ABC_CLASSES.map(async (abcClass) => ({
      abcClass,
      row: await repository.findParameterForClass(abcClass),
    })),
  );

  return new Map(
    parameters.map(({ abcClass, row }) => [
      abcClass,
      row === null
        ? defaultParametersForClass(abcClass)
        : {
            safetyDays: row.safetyDays,
            extraCoverageDays: row.extraCoverageDays,
            averagingWindowDays: row.averagingWindowDays,
            warningMarginRatio: row.warningMarginRatio,
          },
    ]),
  );
}

/**
 * The parameters that actually govern one row.
 *
 * An article-level override beats its class default (brief section 3.4). The
 * map is total, but `Map.get` is typed as possibly-undefined and there is no
 * honest way to tell the compiler otherwise — narrowing here, once, with the
 * same defaults as the loader, beats a `!` at each call site.
 */
function parametersFor(
  byClass: ReadonlyMap<AbcClass, ClassParameters>,
  row: StockItemRow,
): ClassParameters {
  const override = row.article.parameter;

  if (override !== null) {
    return {
      safetyDays: override.safetyDays,
      extraCoverageDays: override.extraCoverageDays,
      averagingWindowDays: override.averagingWindowDays,
      warningMarginRatio: override.warningMarginRatio,
    };
  }

  const abcClass = row.article.abcClass;
  return byClass.get(abcClass) ?? defaultParametersForClass(abcClass);
}

/** What every entry point in this module needs. */
interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: ArticleRepository;
}

export async function list({
  actor,
  input,
  repository = articleRepository,
}: ServiceParams<ArticleListInput>): Promise<Page<ArticleListItem>> {
  // Whatever site the client asked for, this is the site it actually gets.
  const siteId = resolveSiteFilter(actor, input.siteId);

  const [{ rows, totalCount }, parametersByClass] = await Promise.all([
    repository.findMany({ input, siteId }),
    loadParametersByClass(repository),
  ]);

  // The extra row fetched by the repository answers "is there another page?"
  // and must not be returned to the client.
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const items = page.map((row) => {
    const parameters = parametersFor(parametersByClass, row);
    return mapper.toListItem({
      row,
      safetyDays: parameters.safetyDays,
      extraCoverageDays: parameters.extraCoverageDays,
      warningMarginRatio: parameters.warningMarginRatio,
    });
  });

  // Coverage is not a column, so the database could only approximate this sort.
  // Re-sorting the page here makes the displayed order exact. It is a page-local
  // correction, and the screen documents that coverage sorting is within-page.
  const sorted =
    input.sortBy === "coverageDays"
      ? [...items].sort((left, right) => {
          // Articles with no consumption have no coverage; they belong at the
          // end either way rather than sorting as zero.
          const leftValue = left.coverageDays ?? Number.POSITIVE_INFINITY;
          const rightValue = right.coverageDays ?? Number.POSITIVE_INFINITY;
          return input.sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
        })
      : items;

  return {
    items: sorted,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}

export async function byId({
  actor,
  input,
  repository = articleRepository,
}: ServiceParams<ArticleByIdInput>): Promise<ArticleDetail> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const row = await repository.findByArticleAndSite(input.articleId, siteId);

  if (row === null) {
    // Deliberately the same message whether the article does not exist or the
    // actor may not see it: distinguishing them would let a user enumerate the
    // other plant's catalogue by identifier.
    throw new NotFoundError(`Article introuvable : ${input.articleId}`, {
      articleId: input.articleId,
    });
  }

  // A filter cannot protect a lookup by id, so the row that came back is
  // checked against the actor's plant.
  assertCanAccessSite(actor, row.site.id);

  const parametersByClass = await loadParametersByClass(repository);
  const parameters = parametersFor(parametersByClass, row);

  const [lots, movements, thresholdHistory] = await Promise.all([
    repository.findLots(row.id),
    repository.findRecentMovements(row.id, MOVEMENT_HISTORY_LIMIT),
    repository.findThresholdHistory(row.id, THRESHOLD_HISTORY_LIMIT),
  ]);

  const base = mapper.toListItem({
    row,
    safetyDays: parameters.safetyDays,
    extraCoverageDays: parameters.extraCoverageDays,
    warningMarginRatio: parameters.warningMarginRatio,
  });

  // What the logistics study's original model (section 3.1) would have produced
  // on this same article, so the enrichment can be defended with numbers.
  const legacy = computeLegacyThresholds({
    averageDailyConsumption: base.averageDailyConsumption,
    leadTimeDays: base.leadTimeDays,
    safetyStock: base.safetyStock,
  });

  return {
    ...base,
    coverageDays: daysOfCoverage(base.currentStock, base.averageDailyConsumption),
    lots: lots.map(mapper.toLotItem),
    recentMovements: movements.map(mapper.toMovementItem),
    thresholdHistory: thresholdHistory.map(mapper.toThresholdHistoryPoint),
    legacyThresholds: { min: legacy.min, max: legacy.max },
  };
}

/**
 * Creates an article and its stock rows.
 *
 * Authorisation is the router's concern (`article:write`, Administrator only).
 * What belongs here is the consequence: an article exists at every plant or at
 * none, because `StockItem` is what every screen reads. The thresholds start at
 * zero and stay there until a recalculation has real consumption to work from —
 * inventing a Min for an article nobody has consumed yet would put it on the
 * alert board on the day it was created.
 */
export async function create({
  actor,
  input,
  repository = articleRepository,
}: ServiceParams<CreateArticleInput>): Promise<{ articleId: string; reference: string }> {
  const existing = await repository.findByReference(input.reference);

  if (existing !== null) {
    // Caught here rather than left to the unique index, so the message is
    // French and names the reference instead of a constraint.
    throw new BusinessRuleError(`La reference ${input.reference} existe deja.`, {
      reference: input.reference,
    });
  }

  const sites = await repository.findAllSites();

  if (sites.length === 0) {
    throw new BusinessRuleError("Aucun site n est configure : creez un site d abord.", {});
  }

  const articleId = crypto.randomUUID();

  const data = {
    reference: input.reference,
    designation: input.designation,
    unit: input.unit,
    vpe: input.vpe,
    leadTimeDays: input.leadTimeDays,
    abcClass: input.abcClass,
  };

  await repository.createWithAudit({
    articleId,
    data,
    stockItems: sites.map((site) => ({ siteId: site.id, currentStock: input.initialStock })),
    audit: {
      entity: "Article",
      entityId: articleId,
      action: "CREATE",
      before: null,
      after: { ...data, initialStock: input.initialStock },
      actorId: actor.userId,
    },
  });

  return { articleId, reference: input.reference };
}

/** The master-data fields this operation can change, and therefore audits. */
const AUDITED_ARTICLE_FIELDS = [
  "designation",
  "vpe",
  "leadTimeDays",
  "abcClass",
  "isActive",
] as const;

interface AuditableArticle {
  readonly designation: string;
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly abcClass: AbcClass;
  readonly isActive: boolean;
}

function auditedFields(article: AuditableArticle): AuditPayload {
  return Object.fromEntries(AUDITED_ARTICLE_FIELDS.map((field) => [field, article[field]]));
}

/**
 * Updates article master data.
 *
 * Authorisation is the router's concern (`article:write`, Administrator only).
 * What belongs here is the consequence: changing the VPE or the lead time
 * invalidates the stored thresholds, and the caller is told so rather than
 * being left with figures that no longer match the article they describe.
 *
 * The change is audited. Min, Max, VPE and lead time are the numbers every
 * threshold in the application derives from, so "who changed this, and from
 * what" has to be answerable months later — that is what `AuditLog` is for, and
 * the repository writes it in the same transaction as the row.
 */
export async function update({
  actor,
  input,
  repository = articleRepository,
}: ServiceParams<UpdateArticleInput>): Promise<{
  articleId: string;
  thresholdsNeedRecalculation: boolean;
}> {
  const existing = await repository.findRawArticle(input.articleId);

  if (existing === null) {
    throw new NotFoundError(`Article introuvable : ${input.articleId}`, {
      articleId: input.articleId,
    });
  }

  const thresholdsNeedRecalculation =
    existing.leadTimeDays !== input.leadTimeDays || existing.abcClass !== input.abcClass;

  const data = {
    designation: input.designation,
    unit: input.unit,
    vpe: input.vpe,
    leadTimeDays: input.leadTimeDays,
    abcClass: input.abcClass,
    isActive: input.isActive,
  };

  await repository.updateWithAudit({
    articleId: input.articleId,
    data,
    audit: {
      entity: "Article",
      entityId: input.articleId,
      action: "UPDATE",
      // Both sides are recorded so a change can be explained without replaying
      // the whole log, and narrowed to the fields this operation can touch —
      // storing timestamps and ids would bury the two numbers that matter.
      before: auditedFields(existing),
      after: auditedFields(data),
      actorId: actor.userId,
    },
  });

  return { articleId: input.articleId, thresholdsNeedRecalculation };
}

// --- CSV catalogue import (brief section 6.1) -------------------------------

/**
 * Validates one parsed row against the column contract.
 *
 * The line number counts the header as line 1, so a message points at the row
 * a spreadsheet editor shows in its gutter. Getting that wrong makes the errors
 * technically correct and practically useless.
 */
function validateRow(
  raw: Readonly<Record<string, string>>,
  line: number,
): { readonly row: ArticleImportRow } | { readonly errors: readonly ArticleImportError[] } {
  const parsed = articleImportRowSchema.safeParse(raw);

  if (parsed.success) return { row: parsed.data };

  return {
    errors: parsed.error.issues.map((issue) => ({
      line,
      column: typeof issue.path[0] === "string" ? issue.path[0] : null,
      message: issue.message,
    })),
  };
}

/** Columns the file must carry before a single row is worth reading. */
function missingHeaders(headers: readonly string[]): readonly ArticleImportError[] {
  const present = new Set(headers);

  return ARTICLE_IMPORT_COLUMNS.filter((column) => !present.has(column)).map((column) => ({
    line: 1,
    column,
    message: `Colonne absente : ${column}`,
  }));
}

/**
 * References repeated inside one file.
 *
 * Caught before the write rather than left to the unique index, because the
 * index would fail on the *second* occurrence after the first was already
 * committed — and the whole point of this import is that a bad file changes
 * nothing.
 */
function duplicateReferences(
  rows: readonly { readonly row: ArticleImportRow; readonly line: number }[],
): readonly ArticleImportError[] {
  const seen = new Map<string, number>();
  const errors: ArticleImportError[] = [];

  for (const { row, line } of rows) {
    const first = seen.get(row.reference);
    if (first === undefined) {
      seen.set(row.reference, line);
      continue;
    }
    errors.push({
      line,
      column: "reference",
      message: `Reference en double dans le fichier (deja ligne ${String(first)})`,
    });
  }

  return errors;
}

/** Site codes the file names that this installation does not have. */
function unknownSites(
  rows: readonly { readonly row: ArticleImportRow; readonly line: number }[],
  siteIdByCode: ReadonlyMap<string, string>,
): readonly ArticleImportError[] {
  return rows
    .filter(({ row }) => !siteIdByCode.has(row.siteCode))
    .map(({ row, line }) => ({
      line,
      column: "siteCode",
      message: `Site inconnu : ${row.siteCode}`,
    }));
}

/**
 * Imports a catalogue from a CSV export (brief section 6.1).
 *
 * **Nothing is written unless every row is valid.** A half-imported catalogue
 * is the failure mode that costs a day to unpick, and "which rows made it" is
 * not a question anybody can answer from outside the database. So the file is
 * validated whole — headers, then rows, then duplicates within the file, then
 * site codes — and either all of it lands or none of it does, with a line
 * number against every complaint.
 *
 * An existing reference is updated rather than refused. A catalogue export is
 * the source of truth for designation, pack size and lead time, and re-importing
 * it after those change upstream is the normal way this is used.
 *
 * Thresholds are recomputed afterwards with the `IMPORT` trigger, because a
 * freshly imported article has none and a changed VPE or lead time invalidates
 * the ones an existing article had.
 */
export async function importFromCsv({
  actor,
  content,
  repository = articleRepository,
  recalculate = runRecalculation,
}: {
  readonly actor: Actor;
  readonly content: string;
  readonly repository?: ArticleRepository;
  /**
   * Injected for the same reason `repository` is.
   *
   * Without this seam the import could not be tested without a database: the
   * recalculation reaches for its own repository, so every "a valid file is
   * imported" test would have needed Postgres to assert something that has
   * nothing to do with thresholds.
   */
  readonly recalculate?: typeof runRecalculation;
}): Promise<ArticleImportResult> {
  const table = parseCsv(content);

  const headerErrors = missingHeaders(table.headers);
  if (headerErrors.length > 0) {
    return { rows: table.rows.length, imported: 0, updated: 0, errors: headerErrors };
  }

  const validated = table.rows.map((raw, index) => ({
    ...validateRow(raw, index + 2),
    line: index + 2,
  }));

  const rowErrors = validated.flatMap((entry) => ("errors" in entry ? entry.errors : []));
  const good = validated.flatMap((entry) =>
    "row" in entry ? [{ row: entry.row, line: entry.line }] : [],
  );

  const sites = await repository.findSitesWithCodes();
  const siteIdByCode = new Map(sites.map((site) => [site.code, site.id]));

  const errors = [
    ...rowErrors,
    ...duplicateReferences(good),
    ...unknownSites(good, siteIdByCode),
  ].sort((left, right) => left.line - right.line);

  if (errors.length > 0) {
    return { rows: table.rows.length, imported: 0, updated: 0, errors };
  }

  const written = await writeImportedArticles({ actor, repository, rows: good, siteIdByCode });

  // A new article has no thresholds and a changed VPE invalidates the old ones.
  await recalculate({ siteId: null, abcClass: null, trigger: "IMPORT", actorId: actor.userId });

  return { rows: table.rows.length, ...written, errors: [] };
}

/**
 * One audit entry for an imported row, so the two branches cannot drift.
 *
 * A parameter object rather than five positional arguments — past four, the call
 * site stops being readable without checking the signature, which is the rule
 * `max-params` exists to enforce.
 */
function importAudit(inputs: {
  readonly actor: Actor;
  readonly entityId: string;
  readonly action: string;
  readonly before: AuditPayload | null;
  readonly after: AuditPayload;
}): AuditEntry {
  return {
    entity: "Article",
    entityId: inputs.entityId,
    action: inputs.action,
    before: inputs.before,
    after: inputs.after,
    actorId: inputs.actor.userId,
  };
}

/** The master-data fields an import writes, shared by both branches. */
type ImportedMaster = Pick<ArticleImportRow, "designation" | "unit" | "vpe" | "leadTimeDays" | "abcClass">;

/**
 * Creates one imported article, with its stock row at every plant.
 *
 * The stock rows are not optional, for the reason `createWithAudit` states:
 * every screen reads `StockItem`, so an article without them exists in the
 * database and nowhere in the interface. The opening quantity lands at the
 * plant the file named; the others start empty.
 */
async function createImportedArticle(inputs: {
  readonly actor: Actor;
  readonly repository: ArticleRepository;
  readonly row: ArticleImportRow;
  readonly master: ImportedMaster;
  readonly sites: readonly { readonly id: string }[];
  readonly siteIdByCode: ReadonlyMap<string, string>;
}): Promise<void> {
  const { actor, repository, row, master, sites, siteIdByCode } = inputs;

  await repository.createWithAudit({
    articleId: crypto.randomUUID(),
    data: { reference: row.reference, ...master },
    stockItems: sites.map((site) => ({
      siteId: site.id,
      currentStock: site.id === siteIdByCode.get(row.siteCode) ? row.initialStock : 0,
    })),
    audit: importAudit({
      actor,
      entityId: row.reference,
      action: "IMPORT_CREATE",
      before: null,
      after: { reference: row.reference, ...master },
    }),
  });
}

/**
 * Writes the validated rows, one audited transaction each.
 *
 * Per row rather than one transaction for the file, matching
 * `applyThresholdWithHistory`: the unit that has to be consistent is an article
 * and the audit row explaining it, and a single transaction over a whole
 * catalogue would hold locks across every screen for the length of the import.
 *
 * The validation pass has already guaranteed every row is writable, so a
 * failure here is an infrastructure failure rather than a bad file.
 */
async function writeImportedArticles(inputs: {
  readonly actor: Actor;
  readonly repository: ArticleRepository;
  readonly rows: readonly { readonly row: ArticleImportRow; readonly line: number }[];
  readonly siteIdByCode: ReadonlyMap<string, string>;
}): Promise<{ readonly imported: number; readonly updated: number }> {
  const { actor, repository, rows, siteIdByCode } = inputs;

  const existing = await repository.findByReferences(rows.map(({ row }) => row.reference));
  const byReference = new Map(existing.map((article) => [article.reference, article]));

  const sites = await repository.findAllSites();
  let imported = 0;
  let updated = 0;

  for (const { row } of rows) {
    const current = byReference.get(row.reference);
    const master = {
      designation: row.designation,
      unit: row.unit,
      vpe: row.vpe,
      leadTimeDays: row.leadTimeDays,
      abcClass: row.abcClass,
    };

    if (current === undefined) {
      await createImportedArticle({ actor, repository, row, master, sites, siteIdByCode });
      imported += 1;
      continue;
    }

    // Two things an import deliberately leaves alone. The opening stock, because
    // it is an *opening* balance and overwriting a live level with one would
    // silently discard every movement since. And `isActive`, because archiving
    // is a deliberate administrative act — a routine re-import of the upstream
    // catalogue must not quietly resurrect a reference somebody retired.
    await repository.updateWithAudit({
      articleId: current.id,
      data: { ...master, isActive: current.isActive },
      audit: importAudit({
        actor,
        entityId: current.id,
        action: "IMPORT_UPDATE",
        before: {
          designation: current.designation,
          unit: current.unit,
          vpe: current.vpe,
          leadTimeDays: current.leadTimeDays,
          abcClass: current.abcClass,
        },
        after: master,
      }),
    });
    updated += 1;
  }

  return { imported, updated };
}
