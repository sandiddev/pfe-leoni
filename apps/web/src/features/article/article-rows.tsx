"use client";

import { MoreHorizontal, Pencil } from "lucide-react";
import Link from "next/link";

import { type ArticleListItem, MEASUREMENT_UNIT_SYMBOLS_FR } from "@leoni/contracts";
import {
  AlertLevelBadge,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  formatCoverage,
  formatQuantity,
  TableBody,
  TableCell,
  TableNumericCell,
  TableRow,
} from "@leoni/ui";

export interface ArticleRowsProps {
  readonly items: readonly ArticleListItem[];
  readonly canWrite: boolean;
  readonly onEdit: (article: ArticleListItem) => void;
}

/**
 * Every computed column here — the alert level, the coverage in days, the
 * suggested quantity — is rendered from what the server sent. None of it is
 * recalculated in the browser: the formulas live in `@leoni/core` and are unit
 * tested there, and a second implementation in a component would be a second
 * set of numbers for the same article.
 */
export function ArticleRows({ items, canWrite, onEdit }: ArticleRowsProps) {
  return (
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.stockItemId} className={item.isActive ? undefined : "opacity-60"}>
          <TableCell className="font-medium whitespace-nowrap">
            <Link
              href={`/articles/${item.articleId}`}
              className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {item.reference}
            </Link>
          </TableCell>
          <TableCell className="max-w-64 truncate" title={item.designation}>
            {item.designation}
            {!item.isActive && (
              <Badge variant="stopped" className="ml-2">
                Archive
              </Badge>
            )}
          </TableCell>
          <TableCell>
            <Badge variant="outline">{item.abcClass}</Badge>
          </TableCell>
          <TableCell>
            <AlertLevelBadge level={item.alertLevel} />
          </TableCell>
          {/* The unit sits with the stock figure rather than in a column of its
              own: it qualifies a quantity, and a reader scanning the stock
              column should not have to look sideways to know what 1 200 is. */}
          <TableNumericCell>
            {formatQuantity(item.currentStock)}
            <span className="ml-1 text-xs text-foreground-muted">
              {MEASUREMENT_UNIT_SYMBOLS_FR[item.unit]}
            </span>
          </TableNumericCell>
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

          {canWrite && (
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Actions sur ${item.reference}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() => {
                      onEdit(item);
                    }}
                  >
                    <Pencil />
                    Modifier
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/articles/${item.articleId}`}>Ouvrir la fiche</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          )}
        </TableRow>
      ))}
    </TableBody>
  );
}
