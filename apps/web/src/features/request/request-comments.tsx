"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RequestCommentItem } from "@leoni/contracts";
import { Button, formatDateTime, Textarea } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface RequestCommentsProps {
  readonly requestId: string;
  readonly comments: readonly RequestCommentItem[];
  readonly canComment: boolean;
}

/**
 * The discussion, attached to the request it is about.
 *
 * This is the half of the old email thread that was worth keeping: the
 * conversation stays with the demand instead of living in five mailboxes.
 */
export function RequestComments({ requestId, comments, canComment }: RequestCommentsProps) {
  const trpc = useTRPC();
  const router = useRouter();

  const [content, setContent] = useState("");

  const comment = useMutation(
    trpc.request.comment.mutationOptions({
      onSuccess: () => {
        setContent("");
        router.refresh();
      },
    }),
  );

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-sm text-foreground-muted">Aucun echange sur cette demande.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((entry) => (
            <li key={entry.id} className="rounded-md bg-surface-sunken px-3 py-2 text-sm">
              <p className="text-foreground-muted">
                <span className="font-medium text-foreground">{entry.userName}</span>
                {" — "}
                {formatDateTime(entry.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="space-y-2">
          <Textarea
            aria-label="Ajouter un commentaire"
            placeholder="Ajouter un commentaire..."
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
            }}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={comment.isPending || content.trim() === ""}
              onClick={() => {
                comment.mutate({ requestId, content });
              }}
            >
              {comment.isPending ? "Envoi..." : "Commenter"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
