import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@leoni/contracts";
import { env } from "@leoni/env/server";
import { api } from "~/trpc/server";

/**
 * Uploading a file against a request.
 *
 * A route handler rather than a tRPC procedure because tRPC speaks JSON and a
 * file is multipart. Everything else — who may attach to which request — is
 * still decided by the API: this handler validates the bytes and then calls
 * `request.attachments.record`, which runs the same site check as every other
 * read of that request.
 *
 * Order matters, and it used to be the wrong way round. The file was written
 * first and the row second, reasoning that an orphaned file is a cleanup job
 * while an orphaned row is a download link that 404s. True for correctness —
 * and it made disk-filling reachable by anyone holding a session, because
 * `proxy.ts` deliberately does not cover `/api` and the only thing in the way
 * was a 10 MB cap on each request.
 *
 * So rights are checked first, against the API, before a byte reaches the
 * volume. The orphan window is unchanged: if `record` still fails after the
 * write, the file is left behind, which remains the harmless direction.
 */

/** A name safe to put on a filesystem, whatever the browser sent. */
function safeExtension(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}

function isAllowedType(value: string): value is (typeof ALLOWED_ATTACHMENT_TYPES)[number] {
  return ALLOWED_ATTACHMENT_TYPES.some((candidate) => candidate === value);
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get("file");
  const requestId = form.get("requestId");

  if (!(file instanceof File) || typeof requestId !== "string" || requestId === "") {
    return NextResponse.json({ message: "Fichier ou demande manquant." }, { status: 400 });
  }

  if (!isAllowedType(file.type)) {
    return NextResponse.json(
      { message: "Format refuse. Formats acceptes : PDF, PNG, JPEG." },
      { status: 415 },
    );
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      {
        message: `Fichier trop volumineux (maximum ${String(MAX_ATTACHMENT_BYTES / 1024 / 1024)} Mo).`,
      },
      { status: 413 },
    );
  }

  // Before anything is written. A caller with no rights on this request gets
  // nothing on the disk, not a file plus an apology.
  try {
    await api.request.attachments.canUpload({ requestId });
  } catch {
    return NextResponse.json(
      { message: "Enregistrement refuse : verifiez vos droits sur cette demande." },
      { status: 403 },
    );
  }

  // The stored name is generated, never the one the browser sent: a filename
  // is attacker-controlled text, and `../../etc/passwd` is a filename.
  const storedName = `${randomUUID()}${safeExtension(file.type)}`;
  const directory = path.resolve(env.UPLOAD_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, storedName), Buffer.from(await file.arrayBuffer()));

  try {
    const result = await api.request.attachments.record({
      requestId,
      fileName: file.name.slice(0, 255),
      storagePath: storedName,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json(
      { message: "Enregistrement refuse : verifiez vos droits sur cette demande." },
      { status: 403 },
    );
  }
}
