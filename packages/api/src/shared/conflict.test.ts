import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "@leoni/core";

import { guarded } from "./conflict";

/**
 * The guard around a read-compute-write.
 *
 * Small enough to look obviously right and worth a test anyway: it is the only
 * thing standing between two concurrent storekeepers and a silently discarded
 * stock movement, and its failure mode is invisible — the write succeeds, the
 * wrong number lands, nothing is logged.
 */

/**
 * Shaped like Prisma's known-request error, without importing the client.
 *
 * Typed as `Error` because it is one: `guarded` recognises the `code` property
 * structurally, so the test does not need the real class to exercise the path.
 */
function prismaError(code: string): Error {
  return Object.assign(new Error(`Prisma says ${code}`), { code });
}

describe("guarded", () => {
  it("returns the write's result when nothing raced", async () => {
    await expect(guarded(async () => "written", "conflict")).resolves.toBe("written");
  });

  it("turns a where-clause miss into a ConflictError", async () => {
    // P2025 is what Prisma raises when `update` matches no row, which is what a
    // guard clause carrying the previously-read value produces once somebody
    // else has changed it.
    const failure = guarded(
      () => Promise.reject(prismaError("P2025")),
      "La demande a change entre-temps.",
      { requestId: "req-1" },
    );

    await expect(failure).rejects.toBeInstanceOf(ConflictError);
    await expect(failure).rejects.toMatchObject({
      code: "CONFLICT",
      message: "La demande a change entre-temps.",
      details: { requestId: "req-1" },
    });
  });

  it("lets every other Prisma failure through untouched", async () => {
    // A foreign-key violation or a unique-constraint breach is a bug, not a
    // race. Reporting it as "somebody got there first, reload" would send the
    // user round a loop that cannot succeed and hide the real fault.
    await expect(
      guarded(() => Promise.reject(prismaError("P2002")), "conflict"),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("lets a domain error through untouched", async () => {
    await expect(
      guarded(() => Promise.reject(new NotFoundError("Article introuvable")), "conflict"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not mistake a plain error for a lost race", async () => {
    await expect(guarded(() => Promise.reject(new Error("boom")), "conflict")).rejects.toThrow(
      "boom",
    );
  });
});
