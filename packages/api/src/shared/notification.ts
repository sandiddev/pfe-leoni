import type { AlertLevel, NotificationType } from "@leoni/core";
import { crossedIntoShortage } from "@leoni/core";

/**
 * Notifications, as the service layer describes them.
 *
 * Same division of labour as `./audit.ts`, and for the same reason: the service
 * decides *what is worth telling whom*, and the repository guarantees the row
 * lands in the transaction that caused it. A notification written by a second
 * call can announce a stock movement that was rolled back.
 */

/**
 * What a payload may hold.
 *
 * Scalars only, matching `AuditPayload`. A notification is read back from a
 * bell menu weeks later, and a nested object is a value nobody can render at
 * that distance. `Prisma.InputJsonValue` is deliberately not used here: this
 * module is not a `*.repository.ts`, and a lint rule keeps `@leoni/db` out of
 * it — correctly, since the shape of a notification is not a database concern.
 */
export type NotificationPayload = Readonly<Record<string, string | number | boolean | null>>;

/** One notification, built by a service and written by a repository. */
export interface NotificationWrite {
  readonly userId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  readonly payload: NotificationPayload;
}

/** The article a shortage notification is about. */
export interface ShortageSubject {
  readonly articleId: string;
  readonly reference: string;
  readonly designation: string;
  readonly newStock: number;
  readonly minThreshold: number;
}

/**
 * The notifications a stock level crossing into shortage deserves.
 *
 * Returns empty unless the level actually *crossed* — `crossedIntoShortage` in
 * the domain owns that rule, so the manual movement screen, the dispatch to
 * LTN1 and the nightly recalculation all agree about what counts as news. An
 * article that was already critical and received another movement is not news,
 * and notifying on each one is how a bell menu becomes something people mute.
 *
 * The type mirrors the level: a rupture is a starved line, a critical level is a
 * replenishment that is overdue. They read differently in the menu because they
 * demand different urgency.
 */
export function planShortageNotifications(inputs: {
  readonly from: AlertLevel | null;
  readonly to: AlertLevel;
  readonly subject: ShortageSubject;
  readonly recipients: readonly string[];
}): readonly NotificationWrite[] {
  const { from, to, subject, recipients } = inputs;

  if (!crossedIntoShortage(from, to)) return [];

  const type: NotificationType = to === "RUPTURE" ? "STOCK_RUPTURE" : "STOCK_CRITICAL";
  const title =
    to === "RUPTURE"
      ? `Rupture : ${subject.reference}`
      : `Stock critique : ${subject.reference}`;

  return recipients.map((userId) => ({
    userId,
    type,
    title,
    body:
      `${subject.designation} — ${String(subject.newStock)} en stock ` +
      `pour un seuil mini de ${String(subject.minThreshold)}.`,
    payload: {
      articleId: subject.articleId,
      reference: subject.reference,
      level: to,
      currentStock: subject.newStock,
    },
  }));
}
