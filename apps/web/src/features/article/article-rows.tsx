import type { ArticleListItem } from "@leoni/contracts";
import {
  AlertLevelBadge,
  Badge,
  formatCoverage,
  formatQuantity,
  TableBody,
  TableCell,
  TableNumericCell,
  TableRow,
} from "@leoni/ui";

export interface ArticleRowsProps {
  readonly items: readonly ArticleListItem[];
}

/**
 * Every computed column here — the alert level, the coverage in days, the
 * suggested quantity — is rendered from what the server sent. None of it is
 * recalculated in the browser: the formulas live in `@leoni/core` and are unit
 * tested there, and a second implementation in a component would be a second
 * set of numbers for the same article.
 */
export function ArticleRows({ items }: ArticleRowsProps) {
  return (
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.stockItemId}>
          <TableCell className="font-medium whitespace-nowrap">{item.reference}</TableCell>
          <TableCell className="max-w-64 truncate" title={item.designation}>
            {item.designation}
          </TableCell>
          <TableCell>
            <Badge variant="outline">{item.abcClass}</Badge>
          </TableCell>
          <TableCell>
            <AlertLevelBadge level={item.alertLevel} />
          </TableCell>
          <TableNumericCell>{formatQuantity(item.currentStock)}</TableNumericCell>
          <TableNumericCell className="text-foreground-muted">
            {formatQuantity(item.minThreshold)}
          </TableNumericCell>
          <TableNumericCell className="text-foreground-muted">
            {formatQuantity(item.maxThreshold)}
          </TableNumericCell>
          <TableNumericCell
            className={
              item.willRunOutBeforeResupply ? "font-medium text-status-critical" : undefined
            }
            title={
              item.willRunOutBeforeResupply
                ? "La couverture est inferieure au delai de livraison de LTN4"
                : undefined
            }
          >
            {formatCoverage(item.coverageDays)}
          </TableNumericCell>
          <TableNumericCell>
            {item.isReplenishmentNeeded ? (
              <span
                className="font-medium"
                title={`Besoin ${formatQuantity(item.need)} — ${formatQuantity(item.boxCount)} boite(s) de ${formatQuantity(item.vpe)}`}
              >
                {formatQuantity(item.recommendedQuantity)}
              </span>
            ) : (
              <span className="text-foreground-subtle">—</span>
            )}
          </TableNumericCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
