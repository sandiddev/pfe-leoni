"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@leoni/contracts";
import { Button, ConfirmButton, formatDateTime, Spinner, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface RequestAttachmentsProps {
  readonly requestId: string;
  readonly canAttach: boolean;
}

/** Bytes as something a human reads: "1,4 Mo" rather than "1468006". */
function formatSize(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  if (megabytes >= 1) return `${megabytes.toFixed(1)} Mo`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} Ko`;
}

/**
 * Delivery notes, picking sheets, photographs of damaged packaging.
 *
 * Files go through a route handler rather than tRPC, because tRPC speaks JSON
 * and this is multipart. The list and the deletion are ordinary procedures.
 */
export function RequestAttachments({ requestId, canAttach }: RequestAttachmentsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();

  const input = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const query = useQuery(trpc.request.attachments.list.queryOptions({ requestId }));

  const remove = useMutation(
    trpc.request.attachments.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Piece jointe retiree");
        void query.refetch();
      },
      onError: (cause) => {
        toast.error("Suppression refusee", cause.message);
      },
    }),
  );

  async function upload(file: File): Promise<void> {
    setIsUploading(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("requestId", requestId);

      const response = await fetch("/api/attachments", { method: "POST", body });

      if (!response.ok) {
        // The route answers with a French message per failure — wrong format,
        // too large, not your request — so it is worth surfacing verbatim.
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === "object" && payload !== null && "message" in payload
            ? String(payload.message)
            : "Le televersement a echoue.";

        toast.error("Televersement refuse", message);
        return;
      }

      toast.success("Piece jointe ajoutee", file.name);
      void query.refetch();
      void queryClient.invalidateQueries();
    } finally {
      setIsUploading(false);
      if (input.current !== null) input.current.value = "";
    }
  }

  const items = query.data ?? [];

  return (
    <div className="space-y-3">
      {query.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-foreground-muted">
          <Spinner />
          Chargement des pieces jointes...
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-foreground-muted">Aucune piece jointe.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
                <div className="min-w-0">
                  <a
                    href={`/api/attachments/${item.id}`}
                    className="block truncate text-sm font-medium text-primary hover:underline"
                  >
                    {item.fileName}
                  </a>
                  <p className="text-xs text-foreground-muted">
                    {formatSize(item.sizeBytes)} · {item.uploadedByName} ·{" "}
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
              </div>

              {canAttach && (
                <ConfirmButton
                  variant="ghost"
                  size="icon"
                  aria-label={`Retirer ${item.fileName}`}
                  confirmTitle={`Retirer ${item.fileName} ?`}
                  confirmDescription="La piece jointe disparait de la demande. Le fichier reste sur le serveur et peut etre restaure par un administrateur."
                  confirmLabel="Retirer"
                  isPending={remove.isPending}
                  onConfirm={() => {
                    remove.mutate({ attachmentId: item.id });
                  }}
                >
                  <Trash2 />
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAttach && (
        <div className="space-y-1.5">
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
            aria-label="Choisir un fichier a joindre"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void upload(file);
            }}
          />

          <Button
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => {
              input.current?.click();
            }}
          >
            {isUploading ? <Spinner /> : <Upload />}
            {isUploading ? "Televersement..." : "Joindre un fichier"}
          </Button>

          <p className="flex items-center gap-1 text-xs text-foreground-muted">
            <Paperclip className="size-3" aria-hidden />
            PDF, PNG ou JPEG, {String(MAX_ATTACHMENT_BYTES / 1024 / 1024)} Mo maximum.
          </p>
        </div>
      )}
    </div>
  );
}
