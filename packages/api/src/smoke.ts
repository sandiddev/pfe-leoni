/**
 * A headless walk through the whole application, against a seeded database.
 *
 *     pnpm docker:up && pnpm db:seed && pnpm --filter @leoni/api smoke
 *
 * Why this exists alongside the unit tests. The service tests stub the
 * repository, which is what makes the business rules fast to test — but it also
 * means nothing exercises the SQL, the transactions or the order of statements
 * inside them. The first run of this script found exactly that class of bug: a
 * `StockMovement` created before the `StockLot` it points at, which typechecks
 * perfectly and fails on a foreign key the moment a real Postgres sees it.
 *
 * It is not part of `pnpm test`, because that must run without a database.
 * Run it before a demo, and after any change to a repository.
 */
import "@leoni/db/load-env";
import { db } from "@leoni/db";

import { appRouter } from "./root";

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

async function callerFor(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return appRouter.createCaller({
    db,
    requestId: "smoke",
    headers: new Headers(),
    actor: {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      siteId: user.siteId,
    },
  });
}

async function main(): Promise<void> {
  const magasinier = await callerFor("magasinier.ltn1@leoni.tn");
  const responsableLtn1 = await callerFor("responsable.ltn1@leoni.tn");
  const responsableLtn4 = await callerFor("responsable.ltn4@leoni.tn");
  const admin = await callerFor("admin@leoni.tn");
  const logistique = await callerFor("logistique@leoni.tn");

  console.log("\nREAD SCREENS");
  const board = await magasinier.alert.board({ limit: 50, includeNormal: false });
  check("alertes: board returns rows", board.items.length > 0, `(${String(board.totalCount)})`);
  check(
    "alertes: most severe first",
    board.items[0]?.alertLevel === "RUPTURE" || board.items[0]?.alertLevel === "CRITICAL",
  );
  const summary = await magasinier.alert.summary({});
  check("alertes: summary counts every level", "NORMAL" in summary && "RUPTURE" in summary);

  const journal = await magasinier.stock.list({ limit: 10 });
  check("stock: journal returns rows", journal.items.length > 0, `(${String(journal.totalCount)})`);
  const locations = await magasinier.stock.locations({});
  check("stock: locations available", locations.length > 0);
  const byLocation = await magasinier.stock.byLocation({});
  check("stock: per-location view", byLocation.length > 0);

  const requests = await magasinier.request.list({ limit: 25, onlyMine: false, onlyLate: false });
  check("demandes: list returns rows", requests.items.length > 0, `(${String(requests.totalCount)})`);

  const dashboard = await logistique.dashboard.summary({ days: 90 });
  check("dashboard: stock-out history built", dashboard.stockOutHistory.length > 0,
    `(${String(dashboard.stockOutHistory.length)} days)`);
  check("dashboard: every status listed", dashboard.requestsByStatus.length === 14);
  console.log(
    `       service level ${String(dashboard.serviceLevel.rate)}% · ` +
      `real ${String(dashboard.leadTime.averageRealDays)}j vs theoretical ` +
      `${String(dashboard.leadTime.averageTheoreticalDays)}j`,
  );
  const csv = await logistique.dashboard.export({ days: 90 });
  check("dashboard: CSV export", csv.content.includes("Articles suivis"));

  const parameters = await admin.parameter.list({});
  check("parametres: three classes", parameters.length === 3);
  const users = await admin.admin.users.list({ includeInactive: true });
  check("administration: users listed", users.length >= 5);
  const audit = await admin.admin.audit.list({ limit: 10 });
  check("administration: audit log reachable", Array.isArray(audit.items));
  const notifications = await magasinier.notification.list({ limit: 10, onlyUnread: false });
  check("notifications: reachable", Array.isArray(notifications.items));

  console.log("\nSITE SCOPING");
  const ltn4Board = await responsableLtn4.alert.board({ limit: 5, includeNormal: true });
  check(
    "LTN4 sees only LTN4 stock",
    ltn4Board.items.every((item) => item.siteCode === "LTN4"),
  );
  check(
    "LTN1 sees only LTN1 stock",
    board.items.every((item) => item.siteCode === "LTN1"),
  );

  console.log("\nSTOCK MOVEMENT");
  const target = board.items[0];
  if (target === undefined) throw new Error("no alert row to work with");
  const location = locations[0];
  if (location === undefined) throw new Error("no storage location");

  const entry = await magasinier.stock.record({
    articleId: target.articleId,
    type: "ENTRY",
    quantity: target.vpe,
    storageLocationId: location.id,
    reference: "SMOKE-001",
  });
  check(
    "entry raises the stock by exactly the quantity",
    entry.newStock === entry.previousStock + target.vpe,
    `(${String(entry.previousStock)} -> ${String(entry.newStock)})`,
  );

  const exit = await magasinier.stock.record({
    articleId: target.articleId,
    type: "EXIT",
    quantity: target.vpe,
  });
  check("exit draws it back down FIFO", exit.newStock === entry.newStock - target.vpe);

  let refused = false;
  try {
    await magasinier.stock.record({
      articleId: target.articleId,
      type: "EXIT",
      quantity: exit.newStock + 1_000_000,
    });
  } catch {
    refused = true;
  }
  check("an exit larger than the stock is refused", refused);

  console.log("\nWORKFLOW, END TO END");
  const created = await magasinier.request.create({
    priority: "HIGH",
    lines: [{ articleId: target.articleId, requestedQuantity: target.vpe * 2 }],
  });
  check("request created with a code", /^DR-\d{4}-\d{4}$/.test(created.code), created.code);

  const steps = [
    ["submit", magasinier, "PENDING_APPROVAL"],
    ["approve", responsableLtn1, "APPROVED"],
    ["transmit", responsableLtn1, "SENT_TO_LTN4"],
    ["startPreparation", responsableLtn4, "IN_PREPARATION"],
    ["markReady", responsableLtn4, "READY"],
    ["ship", responsableLtn4, "SHIPPED"],
    ["confirmReceipt", magasinier, "RECEIVED"],
    ["close", magasinier, "CLOSED"],
  ] as const;

  for (const [action, caller, expected] of steps) {
    const result = await caller.request.transition({ requestId: created.requestId, action });
    check(`${action} -> ${expected}`, result.status === expected, `got ${result.status}`);

    if (action === "confirmReceipt") {
      check(
        "receipt put the goods into stock",
        result.stockEntries.length === 1 && (result.stockEntries[0]?.quantity ?? 0) > 0,
        JSON.stringify(result.stockEntries),
      );
    }
  }

  const detail = await magasinier.request.byId({ requestId: created.requestId });
  check("trail has one row per transition plus creation", detail.history.length === 9,
    `(${String(detail.history.length)})`);
  check("no action left from a closed request", detail.availableActions.length === 0);
  check(
    "the five quantity columns are all filled",
    detail.lines.every(
      (line) =>
        line.approvedQuantity !== null &&
        line.preparedQuantity !== null &&
        line.shippedQuantity !== null &&
        line.receivedQuantity !== null,
    ),
  );

  console.log("\nWORKFLOW REFUSALS");
  let wrongRole = false;
  try {
    const second = await magasinier.request.create({
      priority: "NORMAL",
      lines: [{ articleId: target.articleId, requestedQuantity: target.vpe }],
    });
    await magasinier.request.transition({ requestId: second.requestId, action: "submit" });
    // The storekeeper who raised it may not also approve it.
    await magasinier.request.transition({ requestId: second.requestId, action: "approve" });
  } catch {
    wrongRole = true;
  }
  check("a storekeeper cannot approve their own request", wrongRole);

  let noReason = false;
  const third = await magasinier.request.create({
    priority: "NORMAL",
    lines: [{ articleId: target.articleId, requestedQuantity: target.vpe }],
  });
  try {
    await magasinier.request.transition({ requestId: third.requestId, action: "cancel" });
  } catch {
    noReason = true;
  }
  check("a cancellation without a reason is refused", noReason);

  await magasinier.request.transition({
    requestId: third.requestId,
    action: "cancel",
    reason: "Annulation de controle du smoke test",
  });
  check("a cancellation with a reason succeeds", true);

  console.log("\nCOMMENTS AND NOTIFICATIONS");
  await magasinier.request.comment({
    requestId: created.requestId,
    content: "Controle automatique",
  });
  const commented = await magasinier.request.byId({ requestId: created.requestId });
  check("comment attached to the request", commented.comments.length === 1);

  const managerInbox = await responsableLtn1.notification.unreadCount({});
  check("the approver was notified", managerInbox.count > 0, `(${String(managerInbox.count)})`);

  console.log("\nTHRESHOLD RECALCULATION");
  const run = await responsableLtn1.parameter.recalculate({});
  check("recalculation covered the catalogue", run.evaluated > 0, `(${String(run.evaluated)})`);
  const history = await responsableLtn1.parameter.history({ limit: 5 });
  check("each recalculation left a history row", history.length > 0);
  check(
    "safetyStock <= min <= max holds",
    history.every((row) => row.safetyStock <= row.minThreshold && row.minThreshold <= row.maxThreshold),
  );

  console.log("\nPERMISSIONS");
  let forbidden = false;
  try {
    await magasinier.parameter.update({
      abcClass: "A",
      safetyDays: 9,
      extraCoverageDays: 9,
      averagingWindowDays: 30,
      warningMarginRatio: 0.5,
    });
  } catch {
    forbidden = true;
  }
  check("a storekeeper cannot edit the parameters", forbidden);

  let noAdmin = false;
  try {
    await logistique.admin.users.list({ includeInactive: true });
  } catch {
    noAdmin = true;
  }
  check("the logistics manager cannot read the user list", noAdmin);
  const readableAudit = await logistique.admin.audit.list({ limit: 1 });
  check("but can read the audit log", Array.isArray(readableAudit.items));

  // A suffix unique to this run, so re-running the smoke test against the same
  // database does not collide on a unique reference or e-mail.
  const runId = String(Date.now()).slice(-6);
  const ltn1Id = board.items[0]?.siteId ?? null;
  if (ltn1Id === null) throw new Error("no LTN1 stock row to work with");

  console.log("\nARTICLE CRUD");
  const reference = `SMOKE-${runId}`;
  const article = await admin.article.create({
    reference,
    designation: "Article de controle automatique",
    vpe: 250,
    leadTimeDays: 3,
    abcClass: "B",
    initialStock: 0,
  });
  check("article created", article.reference === reference.toUpperCase(), article.reference);

  const articleDetail = await admin.article.byId({ articleId: article.articleId, siteId: ltn1Id });
  check("article visible at the plant, so a stock row exists", articleDetail.reference === reference);
  check(
    "legacy comparison is returned for the detail page",
    articleDetail.legacyThresholds.min >= 0 && articleDetail.legacyThresholds.max >= 0,
  );

  await admin.article.update({
    articleId: article.articleId,
    designation: "Article de controle, renomme",
    vpe: 250,
    leadTimeDays: 5,
    abcClass: "A",
    isActive: true,
  });
  const renamed = await admin.article.byId({ articleId: article.articleId, siteId: ltn1Id });
  check("article edited", renamed.designation.endsWith("renomme"));

  console.log("\nPER-ARTICLE PARAMETERS");
  const byClass = await admin.parameter.forArticle({ articleId: article.articleId });
  check("falls back to the class defaults", byClass.source === "CLASS");

  await admin.parameter.upsertForArticle({
    articleId: article.articleId,
    safetyDays: 7,
    extraCoverageDays: 1,
    averagingWindowDays: 7,
    warningMarginRatio: 0.4,
  });
  const overridden = await admin.parameter.forArticle({ articleId: article.articleId });
  check("override applied", overridden.source === "ARTICLE" && overridden.safetyDays === 7);

  await admin.parameter.clearForArticle({ articleId: article.articleId });
  check(
    "override cleared",
    (await admin.parameter.forArticle({ articleId: article.articleId })).source === "CLASS",
  );

  console.log("\nSITES AND LOCATIONS");
  const shelf = await admin.referential.locations.create({
    siteId: ltn1Id,
    code: `ZZ-${runId}`,
    description: "Emplacement de controle",
  });
  check("location created", shelf.storageLocationId.length > 0);

  await admin.stock.record({
    articleId: article.articleId,
    siteId: ltn1Id,
    type: "ENTRY",
    quantity: 250,
    storageLocationId: shelf.storageLocationId,
  });

  let occupiedRefused = false;
  try {
    await admin.referential.locations.remove({ storageLocationId: shelf.storageLocationId });
  } catch {
    occupiedRefused = true;
  }
  check("an occupied shelf cannot be deleted", occupiedRefused);

  await admin.stock.record({
    articleId: article.articleId,
    siteId: ltn1Id,
    type: "EXIT",
    quantity: 250,
  });

  let emptiedRefused = false;
  try {
    await admin.referential.locations.remove({ storageLocationId: shelf.storageLocationId });
  } catch {
    emptiedRefused = true;
  }
  // An exhausted lot still explains a journal line, so the shelf stays.
  check("an emptied but used shelf is still refused", emptiedRefused);

  const unused = await admin.referential.locations.create({
    siteId: ltn1Id,
    code: `ZY-${runId}`,
  });
  await admin.referential.locations.remove({ storageLocationId: unused.storageLocationId });
  check("a never-used shelf can be deleted", true);

  let typeLocked = false;
  try {
    const sites = await admin.referential.sites.list({});
    const ltn1 = sites.find((site) => site.code === "LTN1");
    if (ltn1 === undefined) throw new Error("LTN1 missing");
    await admin.referential.sites.update({ siteId: ltn1.id, name: ltn1.name, type: "SUPPLYING" });
  } catch {
    typeLocked = true;
  }
  check("a site with requests cannot change direction", typeLocked);

  console.log("\nUSER PROVISIONING");
  const provisioned = await admin.admin.users.create({
    name: "Compte de controle",
    email: `smoke.${runId}@leoni.tn`,
    role: "LTN1_STOREKEEPER",
    siteId: ltn1Id,
  });
  check("account provisioned with a password", provisioned.password.length >= 12);

  const signedIn = await db.account.findFirst({
    where: { userId: provisioned.userId, providerId: "credential" },
    select: { password: true, issuer: true },
  });
  check(
    "the credential row exists and stores a hash",
    signedIn?.password !== undefined && signedIn.password !== provisioned.password,
  );

  const reissued = await admin.admin.users.resetPassword({ userId: provisioned.userId });
  check("password reset issues a different one", reissued.password !== provisioned.password);

  console.log("\nDRAFT EDITING");
  const draft = await magasinier.request.create({
    priority: "LOW",
    lines: [{ articleId: target.articleId, requestedQuantity: target.vpe }],
  });
  await magasinier.request.updateDraft({
    requestId: draft.requestId,
    priority: "URGENT",
    lines: [{ articleId: target.articleId, requestedQuantity: target.vpe * 3 }],
  });
  const edited = await magasinier.request.byId({ requestId: draft.requestId });
  check(
    "draft edited in place",
    edited.priority === "URGENT" && edited.lines[0]?.requestedQuantity === target.vpe * 3,
  );

  let editAfterSubmit = false;
  const submitted = await magasinier.request.create({
    priority: "NORMAL",
    lines: [{ articleId: target.articleId, requestedQuantity: target.vpe }],
  });
  await magasinier.request.transition({ requestId: submitted.requestId, action: "submit" });
  try {
    await magasinier.request.updateDraft({
      requestId: submitted.requestId,
      priority: "LOW",
      lines: [{ articleId: target.articleId, requestedQuantity: target.vpe }],
    });
  } catch {
    editAfterSubmit = true;
  }
  check("a submitted request can no longer be edited", editAfterSubmit);

  await magasinier.request.deleteDraft({ requestId: draft.requestId });
  let draftGone = false;
  try {
    await magasinier.request.byId({ requestId: draft.requestId });
  } catch {
    draftGone = true;
  }
  check("draft deleted", draftGone);

  console.log("\nATTACHMENTS");
  await magasinier.request.attachments.record({
    requestId: created.requestId,
    fileName: "bon-de-livraison.pdf",
    storagePath: "smoke-controle.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2_048,
  });
  const attached = await magasinier.request.attachments.list({ requestId: created.requestId });
  check("attachment recorded", attached.length === 1);

  let downloadRefused = false;
  try {
    const other = await callerFor("responsable.ltn4@leoni.tn");
    // LTN4 is at one end of this request, so it may read it. A plant at
    // neither end is the case that must be refused, and there is no third
    // plant seeded — so the check is that LTN4 *can* read it.
    await other.request.attachments.forDownload({ attachmentId: attached[0]?.id ?? "" });
  } catch {
    downloadRefused = true;
  }
  check("the supplying plant can read the attachment it must act on", !downloadRefused);

  await magasinier.request.attachments.remove({ attachmentId: attached[0]?.id ?? "" });
  check(
    "attachment detached",
    (await magasinier.request.attachments.list({ requestId: created.requestId })).length === 0,
  );

  console.log(
    failures.length === 0
      ? "\nAll checks passed."
      : `\n${String(failures.length)} FAILED: ${failures.join(", ")}`,
  );

  await db.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
