import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@leoni/env/server";
import { api } from "~/trpc/server";

/**
 * Downloading an attachment.
 *
 * Authorisation happens before the disk read, through the API, which runs the
 * same site check as every other read of that request. Serving a file by
 * identifier without it is the classic way an upload feature hands a document
 * to the plant it was not meant for.
 *
 * The stored path comes from the database, never from the URL — and is still
 * re-resolved under `UPLOAD_DIR` and checked. A stored path is only as
 * trustworthy as whatever wrote it, and this is the cheapest possible guard
 * against that assumption being wrong later.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  const attachment = await api.request.attachments
    .forDownload({ attachmentId: id })
    .catch(() => null);

  if (attachment === null) {
    return NextResponse.json({ message: "Piece jointe introuvable." }, { status: 404 });
  }

  const directory = path.resolve(env.UPLOAD_DIR);
  const resolved = path.resolve(directory, attachment.storagePath);

  if (!resolved.startsWith(`${directory}${path.sep}`)) {
    return NextResponse.json({ message: "Chemin de fichier invalide." }, { status: 400 });
  }

  const bytes = await readFile(resolved).catch(() => null);

  if (bytes === null) {
    // The row survived and the file did not. Saying so is more useful than a
    // generic failure: it points at the disk rather than at permissions.
    return NextResponse.json({ message: "Fichier absent du serveur." }, { status: 410 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mimeType,
      // `attachment` rather than `inline`: a PDF or an image rendered in the
      // application's own origin is a script-execution surface nobody needs.
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
