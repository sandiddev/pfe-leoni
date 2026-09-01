import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { runNightlyMaintenance } from "@leoni/api";
import { env } from "@leoni/env/server";

/**
 * The nightly threshold recalculation (brief section 3.5).
 *
 * A route handler rather than a tRPC procedure because the caller is the host's
 * scheduler, not a signed-in person: there is no session cookie to build an
 * actor from, and every tRPC procedure requires one. The same computation is
 * also reachable as `parameter.recalculate` for a human pressing Recalculer —
 * one function, two ways in, distinguished only by the trigger written into
 * `ThresholdHistory`.
 *
 * Authorised by a shared secret rather than a user, which is why `JOB_SECRET`
 * has a length floor in `@leoni/env`: it is the only credential protecting a
 * route that rewrites every threshold in the catalogue.
 *
 * `POST` and not `GET`. It changes thousands of rows, and a GET is something a
 * crawler, a link preview or a browser prefetch will do on its own.
 */

/** Compared in constant time: a byte-by-byte early return leaks the secret. */
function isAuthorised(header: string | null): boolean {
  const prefix = "Bearer ";
  if (header?.startsWith(prefix) !== true) return false;

  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(env.JOB_SECRET);

  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // the expected length — so the lengths are compared first and the result is
  // folded in, rather than returned early.
  const sameLength = supplied.length === expected.length;
  return sameLength && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorised(request.headers.get("authorization"))) {
    // No detail. A scheduler reads the status code; anything more descriptive
    // only helps somebody probing the endpoint.
    return NextResponse.json({ message: "Non autorise." }, { status: 401 });
  }

  try {
    const result = await runNightlyMaintenance();
    return NextResponse.json(result, { status: 200 });
  } catch (cause) {
    // Logged rather than returned: the scheduler's log is where a failed run
    // has to be visible, and the message may name a column or a constraint.
    console.error("[job:recalculate] failed", cause);
    return NextResponse.json({ message: "Le recalcul a echoue." }, { status: 500 });
  }
}
