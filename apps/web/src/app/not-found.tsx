import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { Button, Card, CardContent } from "@leoni/ui";

/** Any unknown path. Offers the one link that is always valid. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-4 pt-6 text-center">
          <FileQuestion className="mx-auto size-8 text-foreground-subtle" aria-hidden />

          <div className="space-y-1">
            <h1 className="text-base font-semibold">Page introuvable</h1>
            <p className="text-sm text-foreground-muted">
              Cette adresse ne correspond a aucun ecran de l application.
            </p>
          </div>

          <Button asChild>
            <Link href="/tableau-de-bord">Retour au tableau de bord</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
