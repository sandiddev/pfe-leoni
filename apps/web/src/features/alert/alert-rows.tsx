"use client";

import type { AlertBoardItem } from "@leoni/contracts";
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

export interface AlertRowsProps {
  readonly items: readonly AlertBoardItem[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (articleId: string) => void;
  readonly selectable: boolean;
}

/**
 * Every figure here comes from the server.
 *
 * The suggested quantity is shown with the arithmetic behind it in the tooltip
 * — "besoin 1 800, soit 4 boites de 500" — because a number a storekeeper
 * cannot check is a number they will override by habit.
 */
export function AlertRows({ items, selected, onToggle, selectable }: AlertRowsProps) {
  return (
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.stockItemId}>
          {selectable && (
            <TableCell>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={`Selectionner ${item.reference}`}
                checked={selected.has(item.articleId)}
                disabled={!item.isReplenishmentNeeded}
                onChange={() => {
                  onToggle(item.articleId);
                }}
              />
            </TableCell>
          )}
          <TableCell>
            <AlertLevelBadge level={item.alertLevel} />
          </TableCell>
          <TableCell className="font-medium whitespace-nowrap">{item.reference}</TableCell>
          <TableCell className="max-w-64 truncate" title={item.designation}>
            {item.designation}
          </TableCell>
          <TableCell>
            <Badge variant="outline">{item.abcClass}</Badge>
          </TableCell>
          <TableCell className="text-foreground-muted">{item.siteCode}</TableCell>
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
                title={`Besoin ${formatQuantity(item.need)}, soit ${formatQuantity(item.boxCount)} boite(s) de ${formatQuantity(item.vpe)}`}
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
