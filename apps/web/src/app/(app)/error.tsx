"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button, Card, CardContent } from "@leoni/ui";

/**
 * The boundary for anything a section throws.
 *
 * It deliberately shows no stack trace and no raw message. A tRPC error can
 * carry a Prisma constraint name or a query fragment, and a warehouse screen is
 * not the place for either — the detail goes to the console, where a developer
 * can find it during the defence, and the user gets a sentence and a retry.
 */
export default function SectionError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error("Section boundary caught:", error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-4 pt-6 text-center">
        <TriangleAlert className="mx-auto size-8 text-status-critical" aria-hidden />

        <div className="space-y-1">
          <h1 className="text-base font-semibold">Cette page n a pas pu etre affichee</h1>
          <p className="text-sm text-foreground-muted">
            L operation a echoue. Reessayez : si le probleme persiste, signalez-le en indiquant
            l heure et la page concernee.
          </p>
          {error.digest !== undefined && (
            <p className="text-xs text-foreground-subtle">Reference : {error.digest}</p>
          )}
        </div>

        <Button onClick={reset}>
          <RotateCcw />
          Reessayer
        </Button>
      </CardContent>
    </Card>
  );
}
