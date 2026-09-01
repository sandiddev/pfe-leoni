import { ClipboardX } from "lucide-react";
import Link from "next/link";

import { Button, Card, CardContent } from "@leoni/ui";

/**
 * A request that does not exist, or that belongs to the other plant.
 *
 * Deliberately the same screen for both. Distinguishing them would let anyone
 * with the URL discover which identifiers exist at a plant they cannot see —
 * the same reason `request.byId` returns one message for both cases.
 */
export default function RequestNotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-4 pt-6 text-center">
        <ClipboardX className="mx-auto size-8 text-foreground-subtle" aria-hidden />

        <div className="space-y-1">
          <h1 className="text-base font-semibold">Demande introuvable</h1>
          <p className="text-sm text-foreground-muted">
            Cette demande n existe pas, ou elle ne concerne pas votre site.
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href="/demandes">Retour aux demandes</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
