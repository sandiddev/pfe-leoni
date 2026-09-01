import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can } from "@leoni/core";
import { PageHeader } from "@leoni/ui";
import { ArticleDetailView } from "~/features/article/article-detail-view";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Article" };

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * One article at one plant.
 *
 * Every figure here comes from `article.byId`, which has returned the lots, the
 * journal, the threshold history and the legacy-versus-enriched comparison
 * since the module was written — and which, until now, no screen called.
 */
export default async function ArticleDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [actor, article] = await Promise.all([
    api.session.me(),
    api.article.byId({ articleId: id }).catch(() => null),
  ]);

  if (article === null) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${article.reference} — ${article.designation}`}
        description={`Site ${article.siteCode} · classe ${article.abcClass} · VPE ${String(article.vpe)} · delai ${String(article.leadTimeDays)} j`}
      />

      <ArticleDetailView article={article} canWrite={can(actor.role, "article:write")} />
    </div>
  );
}
