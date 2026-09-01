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

import { runNightlyMaintenance } from "./jobs/nightly";
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
  // One suffix for every reference this run invents, so a re-run collides with
  // nothing it created last time.
  const stamp = String(Date.now()).slice(-6);

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
  check(
    "demandes: list returns rows",
    requests.items.length > 0,
    `(${String(requests.totalCount)})`,
  );

  const dashboard = await logistique.dashboard.summary({ days: 90 });
  check(
    "dashboard: stock-out history built",
    dashboard.stockOutHistory.length > 0,
    `(${String(dashboard.stockOutHistory.length)} days)`,
  );
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

  console.log("\nBATCH TRACEABILITY");
  const batchTarget = await db.stockItem.findFirstOrThrow({
    where: { siteId: (await db.site.findFirstOrThrow({ where: { code: "LTN1" } })).id },
    select: { articleId: true },
  });
  const batchLocation = await magasinier.stock.locations({});

  const withBatch = await magasinier.stock.record({
    articleId: batchTarget.articleId,
    type: "ENTRY",
    quantity: 10,
    storageLocationId: batchLocation[0]?.id ?? "",
    batchReference: `LOT-SMOKE-${stamp}`,
    supplierReference: "TE Connectivity",
  });

  const createdLot = await db.stockLot.findFirstOrThrow({
    where: { batchReference: `LOT-SMOKE-${stamp}` },
    select: { batchReference: true, supplierReference: true, quantity: true },
  });
  check(
    "an inbound movement records the supplier batch on the lot it creates",
    createdLot.supplierReference === "TE Connectivity" && createdLot.quantity === 10,
    JSON.stringify(createdLot),
  );
  check("and the movement itself succeeded", withBatch.newStock > 0);

  // A batch is a property of stock arriving; FIFO decides which leave.
  await magasinier.stock.record({
    articleId: batchTarget.articleId,
    type: "EXIT",
    quantity: 5,
    batchReference: "LOT-QUE-PERSONNE-NA-RECU",
  });
  check(
    "an outbound movement invents no lot for a batch it was handed",
    (await db.stockLot.count({ where: { batchReference: "LOT-QUE-PERSONNE-NA-RECU" } })) === 0,
  );

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

  // Both plants' levels before the transfer, so conservation can be asserted
  // rather than assumed. This is the invariant the dispatch half exists for:
  // before it, every request created units out of nothing.
  const stockFor = async (siteCode: string) => {
    const site = await db.site.findFirstOrThrow({ where: { code: siteCode } });
    const item = await db.stockItem.findUnique({
      where: { articleId_siteId: { articleId: target.articleId, siteId: site.id } },
      select: { currentStock: true },
    });
    return item?.currentStock ?? 0;
  };

  const ltn4Before = await stockFor("LTN4");
  const ltn1Before = await stockFor("LTN1");

  let debited = 0;
  let credited = 0;

  for (const [action, caller, expected] of steps) {
    const result = await caller.request.transition({ requestId: created.requestId, action });
    check(`${action} -> ${expected}`, result.status === expected, `got ${result.status}`);

    if (action === "ship") {
      debited = result.stockExits.reduce((sum, exit) => sum + exit.quantity, 0);
      check(
        "the dispatch took the goods off the supplying plant",
        result.stockExits.length === 1 && debited > 0,
        JSON.stringify(result.stockExits),
      );
      // In transit: off LTN4's books and not yet on LTN1's.
      check("and nothing arrived anywhere yet", result.stockEntries.length === 0);
    }

    if (action === "confirmReceipt") {
      credited = result.stockEntries.reduce((sum, entry) => sum + entry.quantity, 0);
      check(
        "receipt put the goods into stock",
        result.stockEntries.length === 1 && credited > 0,
        JSON.stringify(result.stockEntries),
      );
    }
  }

  const ltn4After = await stockFor("LTN4");
  const ltn1After = await stockFor("LTN1");

  check(
    "LTN4 was debited by exactly what it shipped",
    ltn4After === ltn4Before - debited,
    `(${String(ltn4Before)} -> ${String(ltn4After)}, shipped ${String(debited)})`,
  );
  check(
    "LTN1 was credited by exactly what it received",
    ltn1After === ltn1Before + credited,
    `(${String(ltn1Before)} -> ${String(ltn1After)}, received ${String(credited)})`,
  );
  check(
    "a full cycle conserves the total units across both plants",
    ltn4After + ltn1After === ltn4Before + ltn1Before,
    `(${String(ltn4Before + ltn1Before)} -> ${String(ltn4After + ltn1After)})`,
  );

  const transferJournal = await db.stockMovement.findMany({
    where: { reference: created.requestId },
    select: { type: true, quantity: true },
  });
  check(
    "both legs are in the journal, as transfers rather than entries",
    transferJournal.length === 2 &&
      transferJournal.some((row) => row.type === "TRANSFER_OUT") &&
      transferJournal.some((row) => row.type === "TRANSFER_IN"),
    JSON.stringify(transferJournal),
  );

  const detail = await magasinier.request.byId({ requestId: created.requestId });
  check(
    "trail has one row per transition plus creation",
    detail.history.length === 9,
    `(${String(detail.history.length)})`,
  );
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

  console.log("\nPARTIAL DELIVERY (brief section 6)");

  // The whole chain with an explicit figure at every stage, each one smaller
  // than the last. Before the dialog sent `lines`, none of these columns could
  // hold anything but the requested quantity carried forward, so
  // PARTIALLY_AVAILABLE recorded a reason and no shortfall.
  // A reference the supplying plant genuinely holds four packs of, chosen at
  // run time rather than reused from the alert board. The earlier end-to-end
  // walk ships that article, so a fixed choice drains LTN4 a little on every
  // run and this section would eventually fail for a reason that is not a bug.
  const ltn4 = await db.site.findFirstOrThrow({ where: { code: "LTN4" } });
  const wellStocked = await db.stockItem.findFirstOrThrow({
    where: { siteId: ltn4.id, article: { isActive: true, vpe: { gt: 0 } } },
    orderBy: { currentStock: "desc" },
    select: { articleId: true, currentStock: true, article: { select: { vpe: true } } },
  });
  const pack = wellStocked.article.vpe;
  check(
    "the supplying plant holds enough of the chosen reference to test a partial",
    wellStocked.currentStock >= pack * 4,
    `(${String(wellStocked.currentStock)} in stock, pack ${String(pack)})`,
  );

  const partial = await magasinier.request.create({
    priority: "NORMAL",
    lines: [{ articleId: wellStocked.articleId, requestedQuantity: pack * 4 }],
  });

  const lineId = async () =>
    (await magasinier.request.byId({ requestId: partial.requestId })).lines[0]?.id ?? "";

  const partialLine = await lineId();

  await magasinier.request.transition({ requestId: partial.requestId, action: "submit" });
  await responsableLtn1.request.transition({
    requestId: partial.requestId,
    action: "approve",
    lines: [{ lineId: partialLine, quantity: pack * 3 }],
  });
  await responsableLtn1.request.transition({ requestId: partial.requestId, action: "transmit" });
  await responsableLtn4.request.transition({
    requestId: partial.requestId,
    action: "declarePartial",
    reason: "Rupture partielle sur ce composant chez LTN4",
    lines: [{ lineId: partialLine, quantity: pack * 2 }],
  });

  const declared = await magasinier.request.byId({ requestId: partial.requestId });
  check(
    "a declared shortage carries the quantity it can actually supply",
    declared.status === "PARTIALLY_AVAILABLE" && declared.lines[0]?.preparedQuantity === pack * 2,
    `(${String(declared.lines[0]?.preparedQuantity)} of ${String(pack * 3)} approved)`,
  );

  await responsableLtn4.request.transition({ requestId: partial.requestId, action: "markReady" });
  await responsableLtn4.request.transition({
    requestId: partial.requestId,
    action: "ship",
    lines: [{ lineId: partialLine, quantity: pack }],
  });
  await magasinier.request.transition({ requestId: partial.requestId, action: "confirmReceipt" });

  const settled = await magasinier.request.byId({ requestId: partial.requestId });
  const chain = settled.lines[0];

  check(
    "each stage recorded its own figure, monotonically decreasing",
    chain?.requestedQuantity === pack * 4 &&
      chain.approvedQuantity === pack * 3 &&
      chain.preparedQuantity === pack * 2 &&
      chain.shippedQuantity === pack &&
      // Nothing was said at receipt, so it carries the shipped figure forward.
      chain.receivedQuantity === pack,
    JSON.stringify({
      requested: chain?.requestedQuantity,
      approved: chain?.approvedQuantity,
      prepared: chain?.preparedQuantity,
      shipped: chain?.shippedQuantity,
      received: chain?.receivedQuantity,
    }),
  );

  check(
    "every recorded quantity is a whole multiple of the pack size",
    chain !== undefined &&
      [
        chain.approvedQuantity,
        chain.preparedQuantity,
        chain.shippedQuantity,
        chain.receivedQuantity,
      ]
        .filter((value): value is number => value !== null)
        .every((value) => value % chain.vpeSnapshot === 0),
  );

  // Only what was shipped may move: the shortfall must not reach the journal.
  const partialMovements = await db.stockMovement.findMany({
    where: { reference: partial.requestId },
    select: { type: true, quantity: true },
  });
  check(
    "only the shipped quantity moved, not the approved one",
    partialMovements.length === 2 && partialMovements.every((row) => row.quantity === pack),
    JSON.stringify(partialMovements),
  );

  let unevenRefused = false;
  try {
    const uneven = await magasinier.request.create({
      priority: "LOW",
      lines: [{ articleId: wellStocked.articleId, requestedQuantity: pack }],
    });
    await magasinier.request.transition({ requestId: uneven.requestId, action: "submit" });
    const unevenLine =
      (await magasinier.request.byId({ requestId: uneven.requestId })).lines[0]?.id ?? "";
    await responsableLtn1.request.transition({
      requestId: uneven.requestId,
      action: "approve",
      lines: [{ lineId: unevenLine, quantity: -5 }],
    });
  } catch {
    unevenRefused = true;
  }
  check("a negative quantity is refused by the schema", unevenRefused);

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
    history.every(
      (row) => row.safetyStock <= row.minThreshold && row.minThreshold <= row.maxThreshold,
    ),
  );

  // The LTN1 manager's run is site-scoped, so it must not have touched the
  // cross-site ABC classes even though it left no class filter.
  check("a site-scoped run does not reclassify", run.reclassified === 0);

  const unscoped = await admin.parameter.recalculate({});
  check(
    "an unscoped run reports its reclassification count",
    typeof unscoped.reclassified === "number",
    `(${String(unscoped.reclassified)} moved)`,
  );

  // Run twice: the Pareto breaks ties on articleId, so a second pass over
  // unchanged consumption must move nobody. A run that reshuffles every night
  // would make the threshold history impossible to interpret.
  const again = await admin.parameter.recalculate({});
  check("reclassification is stable across consecutive runs", again.reclassified === 0);

  const manualTrail = await admin.parameter.history({ limit: 5 });
  check(
    "the manual run is recorded as MANUAL",
    manualTrail.some((row) => row.trigger === "MANUAL"),
  );

  console.log("\nSCHEDULED JOB (brief section 3.5)");
  const nightly = await runNightlyMaintenance();
  check("the job evaluated the catalogue", nightly.evaluated > 0, `(${String(nightly.evaluated)})`);
  const scheduledTrail = await admin.parameter.history({ limit: 5 });
  check(
    "the job is recorded as SCHEDULED, not as a person",
    scheduledTrail.some((row) => row.trigger === "SCHEDULED"),
  );

  console.log("\nDAILY SNAPSHOTS AND STOCK NOTIFICATIONS");
  const trackedAtBoth = await db.stockItem.count({ where: { article: { isActive: true } } });

  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const snapshotsToday = await db.stockAlertSnapshot.count({
    where: { snapshotDate: todayUtc },
  });
  // Asserted on the resulting table rather than on how many rows the job
  // appended: this script is re-runnable, and a second run of the same day
  // legitimately appends only the articles created since the first.
  check(
    "the job left one snapshot per tracked article, stamped today",
    snapshotsToday === trackedAtBoth,
    `(${String(snapshotsToday)} rows for ${String(trackedAtBoth)} articles)`,
  );
  check(
    "and reported what it appended",
    nightly.snapshotted >= 0,
    `(${String(nightly.snapshotted)} appended)`,
  );

  // Idempotent: the scheduler may retry, and a KPI that moves when nothing
  // happened is worse than one that is a day stale.
  const secondRun = await runNightlyMaintenance();
  check(
    "an immediate second run appends nothing",
    secondRun.snapshotted === 0,
    `(${String(secondRun.snapshotted)})`,
  );
  const stillOnePerArticle = await db.stockAlertSnapshot.count({
    where: { snapshotDate: todayUtc },
  });
  check(
    "and leaves exactly one row per article",
    stillOnePerArticle === trackedAtBoth,
    `(${String(stillOnePerArticle)})`,
  );

  // A movement that empties an article must reach the notification centre.
  const ltn1Site = await db.site.findFirstOrThrow({ where: { code: "LTN1" } });
  const healthy = await db.stockItem.findFirstOrThrow({
    where: { siteId: ltn1Site.id, alertLevel: "NORMAL", currentStock: { gt: 0 } },
    select: { articleId: true, currentStock: true },
  });

  const inboxBefore = await magasinier.notification.unreadCount({});
  await magasinier.stock.record({
    articleId: healthy.articleId,
    type: "EXIT",
    quantity: healthy.currentStock,
  });
  const inboxAfter = await magasinier.notification.unreadCount({});

  check(
    "emptying an article notifies the plant",
    inboxAfter.count > inboxBefore.count,
    `(${String(inboxBefore.count)} -> ${String(inboxAfter.count)})`,
  );

  const raised = await db.notification.findFirst({
    where: { type: "STOCK_RUPTURE" },
    orderBy: { createdAt: "desc" },
    select: { type: true, title: true },
  });
  check(
    "as a rupture rather than a generic alert",
    raised?.type === "STOCK_RUPTURE",
    raised?.title ?? "none",
  );

  // A movement on an article that is *already* short must stay silent, or the
  // bell menu becomes something people mute. Small enough to leave the level
  // where it is: critical to critical is not news.
  const alreadyShort = await db.stockItem.findFirstOrThrow({
    where: { siteId: ltn1Site.id, alertLevel: "CRITICAL", currentStock: { gt: 10 } },
    select: { articleId: true },
  });

  const quietBefore = await magasinier.notification.unreadCount({});
  await magasinier.stock.record({
    articleId: alreadyShort.articleId,
    type: "EXIT",
    quantity: 1,
  });
  const quietAfter = await magasinier.notification.unreadCount({});
  check(
    "but a movement on an already-critical article does not",
    quietAfter.count === quietBefore.count,
    `(${String(quietBefore.count)} -> ${String(quietAfter.count)})`,
  );

  console.log("\nPARAMETER EDIT TAKES EFFECT");
  // An article with consumption: `Min = average x (leadTime + safetyDays)`, so a
  // reference that has never moved has a threshold of 0 whatever the parameters
  // say, and would report "unchanged" for a reason that is not the one tested.
  const beforeEdit = await db.stockItem.findFirstOrThrow({
    where: { article: { abcClass: "A", isActive: true }, minThreshold: { gt: 0 } },
    select: { id: true, minThreshold: true },
  });

  // Moving the safety days must move the reorder point of every class A
  // article, without anybody pressing Recalculer afterwards.
  //
  // Toggled against whatever is currently stored rather than set to a fixed
  // number: this script is re-runnable, and writing the value it already holds
  // would be a real no-op reported as a failure.
  const classA = (await admin.parameter.list({})).find((row) => row.abcClass === "A");
  await admin.parameter.update({
    abcClass: "A",
    safetyDays: classA?.safetyDays === 8 ? 4 : 8,
    extraCoverageDays: 3,
    averagingWindowDays: 30,
    warningMarginRatio: 0.2,
  });

  const afterEdit = await db.stockItem.findUniqueOrThrow({
    where: { id: beforeEdit.id },
    select: { minThreshold: true },
  });

  check(
    "editing a class parameter recomputed its articles",
    !afterEdit.minThreshold.equals(beforeEdit.minThreshold),
    `(${beforeEdit.minThreshold.toString()} -> ${afterEdit.minThreshold.toString()})`,
  );

  const editTrail = await admin.parameter.history({ limit: 5 });
  check(
    "the recomputation says a parameter change caused it",
    editTrail.some((row) => row.trigger === "PARAMETER_CHANGE"),
  );

  console.log("\nCONCURRENCY GUARDS");
  console.log("       (the prisma:error lines below are the losing writes being refused)");
  const racing = await callerFor("magasinier.ltn1@leoni.tn");

  // Its own draft rather than a seeded one: this section submits the request it
  // races on, so borrowing a seeded DRAFT would leave none for the next run and
  // make the script pass exactly once per seed.
  const raceTarget = await racing.request.create({
    priority: "LOW",
    lines: [{ articleId: target.articleId, requestedQuantity: target.vpe }],
  });

  // Both callers validated against DRAFT; only one may apply. Before the guard
  // both wrote, leaving two history rows for one transition.
  const outcomes = await Promise.allSettled([
    racing.request.transition({ requestId: raceTarget.requestId, action: "submit" }),
    racing.request.transition({ requestId: raceTarget.requestId, action: "submit" }),
  ]);

  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
  check(
    "exactly one of two simultaneous transitions applied",
    fulfilled === 1,
    `(${String(fulfilled)})`,
  );

  const submissions = await db.requestStatusHistory.count({
    where: { requestId: raceTarget.requestId, toStatus: "PENDING_APPROVAL" },
  });
  check("and it left exactly one history row", submissions === 1, `(${String(submissions)})`);

  const raceArticle = await db.stockItem.findFirstOrThrow({
    where: {
      siteId: (await db.site.findFirstOrThrow({ where: { code: "LTN1" } })).id,
      currentStock: { gte: 500 },
    },
    select: { id: true, articleId: true, currentStock: true },
  });

  const movements = await Promise.allSettled([
    magasinier.stock.record({ articleId: raceArticle.articleId, type: "EXIT", quantity: 10 }),
    magasinier.stock.record({ articleId: raceArticle.articleId, type: "EXIT", quantity: 10 }),
  ]);

  const applied = movements.filter((outcome) => outcome.status === "fulfilled").length;
  const afterRace = await db.stockItem.findUniqueOrThrow({
    where: { id: raceArticle.id },
    select: { currentStock: true },
  });

  // Whatever survived, the level must equal the start minus exactly what was
  // applied. A lost update shows up here as a stock that fell by 10 when two
  // movements of 10 both reported success.
  check(
    "concurrent movements never lose one another",
    afterRace.currentStock === raceArticle.currentStock - applied * 10,
    `(${String(applied)} applied, ${String(raceArticle.currentStock)} -> ${String(afterRace.currentStock)})`,
  );

  console.log("\nCSV CATALOGUE IMPORT (brief section 6.1)");
  const importHeader =
    "reference,designation,unit,vpe,leadTimeDays,abcClass,initialStock,siteCode";

  const articlesBefore = await db.article.count();

  // A bad file must change nothing at all — the invariant the feature turns on.
  const refusedImport = await admin.article.import({
    content:
      `${importHeader}\n` +
      `SMOKE-${stamp}-A,Article valide,PIECE,250,2,A,500,LTN1\n` +
      `SMOKE-${stamp}-B,Article invalide,PIECE,0,2,A,0,LTN1\n`,
  });
  check(
    "a file with one bad row is refused whole",
    refusedImport.errors.length === 1 && refusedImport.imported === 0,
    JSON.stringify(refusedImport.errors),
  );
  check(
    "and nothing was written",
    (await db.article.count()) === articlesBefore,
    `(${String(articlesBefore)})`,
  );

  const accepted = await admin.article.import({
    content:
      `${importHeader}\n` +
      `SMOKE-${stamp}-A,Boitier importe,PIECE,250,2,A,500,LTN1\n` +
      `SMOKE-${stamp}-B,Cosse importee,METRE,100,3,C,0,LTN4\n`,
  });
  check(
    "a valid file imports every row",
    accepted.imported === 2 && accepted.errors.length === 0,
    JSON.stringify(accepted),
  );

  const importedArticle = await db.article.findUniqueOrThrow({
    where: { reference: `SMOKE-${stamp}-A` },
    select: {
      id: true,
      vpe: true,
      stockItems: { select: { currentStock: true, site: { select: { code: true } } } },
    },
  });
  check("with a stock row at every plant", importedArticle.stockItems.length === 2);
  check(
    "and the opening quantity only at the plant the file named",
    importedArticle.stockItems.find((item) => item.site.code === "LTN1")?.currentStock === 500 &&
      importedArticle.stockItems.find((item) => item.site.code === "LTN4")?.currentStock === 0,
  );

  check(
    "the unit came through the import and is not the default",
    (await db.article.findUniqueOrThrow({ where: { reference: `SMOKE-${stamp}-B` } })).unit ===
      "METRE",
  );

  const importTrail = await db.thresholdHistory.findFirst({
    where: { trigger: "IMPORT" },
    select: { trigger: true },
  });
  check("the import recomputed thresholds under its own trigger", importTrail !== null);

  // Re-importing the same references updates rather than failing on the index.
  const reimported = await admin.article.import({
    content: `${importHeader}\nSMOKE-${stamp}-A,Libelle corrige,PIECE,500,4,B,999,LTN1\n`,
  });
  check(
    "a re-import updates instead of refusing",
    reimported.updated === 1 && reimported.imported === 0,
    JSON.stringify(reimported),
  );

  const afterReimport = await db.article.findUniqueOrThrow({
    where: { reference: `SMOKE-${stamp}-A` },
    select: {
      designation: true,
      vpe: true,
      stockItems: { select: { currentStock: true, site: { select: { code: true } } } },
    },
  });
  check(
    "master data was updated",
    afterReimport.designation === "Libelle corrige" && afterReimport.vpe === 500,
  );
  check(
    "but the live stock level was not overwritten by an opening balance",
    afterReimport.stockItems.find((item) => item.site.code === "LTN1")?.currentStock === 500,
    `(${String(afterReimport.stockItems.find((item) => item.site.code === "LTN1")?.currentStock)})`,
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
  check(
    "article visible at the plant, so a stock row exists",
    articleDetail.reference === reference,
  );
  check(
    "legacy comparison is returned for the detail page",
    articleDetail.legacyThresholds.min >= 0 && articleDetail.legacyThresholds.max >= 0,
  );

  await admin.article.update({
    articleId: article.articleId,
    designation: "Article de controle, renomme",
    unit: "METRE",
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
