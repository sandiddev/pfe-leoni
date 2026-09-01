import type { StockMovementListItem } from "@leoni/contracts";
import {
  formatDateTime,
  formatQuantity,
  TableBody,
  TableCell,
  TableNumericCell,
  TableRow,
} from "@leoni/ui";

import { MovementTypeBadge } from "./movement-type-badge";

/** Movements that reduce the stock, so the quantity can be read with a sign. */
const OUTBOUND = new Set(["EXIT", "TRANSFER_OUT"]);

export interface StockRowsProps {
  readonly items: readonly StockMovementListItem[];
}

export function StockRows({ items }: StockRowsProps) {
  return (
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="whitespace-nowrap text-foreground-muted">
            {formatDateTime(item.occurredAt)}
          </TableCell>
          <TableCell>
            <MovementTypeBadge type={item.type} />
          </TableCell>
          <TableCell className="font-medium whitespace-nowrap">{item.articleReference}</TableCell>
          <TableCell className="max-w-56 truncate" title={item.articleDesignation}>
            {item.articleDesignation}
          </TableCell>
          <TableNumericCell
            className={OUTBOUND.has(item.type) ? "text-status-critical" : "text-status-normal"}
          >
            {OUTBOUND.has(item.type) ? "-" : "+"}
            {formatQuantity(item.quantity)}
          </TableNumericCell>
          <TableCell className="whitespace-nowrap text-foreground-muted">
            {item.locationCode ?? "—"}
          </TableCell>
          <TableCell className="text-foreground-muted">{item.siteCode}</TableCell>
          <TableCell className="max-w-40 truncate text-foreground-muted" title={item.reference ?? ""}>
            {item.reference ?? "—"}
          </TableCell>
          <TableCell className="text-foreground-muted">{item.userName ?? "Systeme"}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
