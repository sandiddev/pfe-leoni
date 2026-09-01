import type { ArticleDetail } from "@leoni/contracts";
import { formatQuantity } from "@leoni/ui";

export interface ThresholdComparisonProps {
  readonly article: ArticleDetail;
}

/** A change, expressed as the percentage a reader would compute themselves. */
function delta(enriched: number, legacy: number): string {
  if (legacy === 0) return "—";
  const change = Math.round(((enriched - legacy) / legacy) * 100);
  return `${change >= 0 ? "+" : ""}${String(change)} %`;
}

/**
 * The study's original model against the enriched one (brief section 3.1/3.2).
 *
 * This is the comparison the report is written around, and it has never been on
 * a screen. Showing both side by side is what lets the enrichment be defended
 * with numbers rather than argument: the study's Min covers only LTN4's lead
 * time, so it fires when there is *just* enough stock for a perfectly nominal
 * delivery — the enriched Min folds the safety margin into the trigger.
 */
export function ThresholdComparison({ article }: ThresholdComparisonProps) {
  const rows = [
    {
      label: "Seuil mini",
      legacy: article.legacyThresholds.min,
      enriched: article.minThreshold,
    },
    {
      label: "Seuil maxi",
      legacy: article.legacyThresholds.max,
      enriched: article.maxThreshold,
    },
  ];

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium text-foreground-muted">Indicateur</dt>
        <dd className="text-right font-medium text-foreground-muted">Modele de l etude</dd>
        <dd className="text-right font-medium text-foreground-muted">Modele enrichi</dd>
        <dd className="text-right font-medium text-foreground-muted">Ecart</dd>

        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt>{row.label}</dt>
            <dd className="tabular text-right text-foreground-muted">
              {formatQuantity(row.legacy)}
            </dd>
            <dd className="tabular text-right font-medium">{formatQuantity(row.enriched)}</dd>
            <dd className="tabular text-right text-foreground-muted">
              {delta(row.enriched, row.legacy)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-foreground-muted">
        Le modele de l etude declenche au bout du seul delai de livraison. Le modele enrichi
        integre le stock de securite dans le seuil de declenchement, de sorte que la variabilite
        de consommation pendant le delai ne mord pas sur la production.
      </p>
    </div>
  );
}
