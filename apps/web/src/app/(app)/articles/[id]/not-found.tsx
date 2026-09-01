import { PackageX } from "lucide-react";
import Link from "next/link";

import { Button, Card, CardContent } from "@leoni/ui";

/**
 * An article that does not exist, or that belongs to the other plant.
 *
 * The same screen for both, for the same reason `article.byId` returns one
 * message for both: distinguishing them would let anyone with the URL
 * enumerate the other plant's catalogue by identifier.
 */
export default function ArticleNotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-4 pt-6 text-center">
        <PackageX className="mx-auto size-8 text-foreground-subtle" aria-hidden />

        <div className="space-y-1">
          <h1 className="text-base font-semibold">Article introuvable</h1>
          <p className="text-sm text-foreground-muted">
            Cette reference n existe pas, ou elle n est pas suivie sur votre site.
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href="/articles">Retour au catalogue</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
