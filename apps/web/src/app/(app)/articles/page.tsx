import type { Metadata } from "next";

import { PageHeader } from "@leoni/ui";
import { ArticleTable } from "~/features/article/article-table";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Articles" };

/**
 * The article catalogue with its computed stock columns.
 *
 * A Server Component: the first page of data is fetched in-process and arrives
 * with the HTML, so the storekeeper sees rows rather than a spinner. Filtering
 * and sorting from then on happen in the client component below.
 */
export default async function ArticlesPage() {
  const page = await api.article.list({
    limit: 25,
    onlyReplenishable: false,
    includeInactive: false,
    sortBy: "reference",
    sortDirection: "asc",
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Articles"
        description={`${String(page.totalCount)} references suivies. Les seuils mini et maxi sont recalcules a partir de la consommation reelle.`}
      />

      <ArticleTable initialItems={page.items} totalCount={page.totalCount} />
    </div>
  );
}
