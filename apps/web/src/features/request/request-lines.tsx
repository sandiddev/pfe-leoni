import type { RequestLineItem } from "@leoni/contracts";
import {
  formatQuantity,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
} from "@leoni/ui";

export interface RequestLinesProps {
  readonly lines: readonly RequestLineItem[];
}

/** A column that has not been reached yet reads as a dash, never as zero. */
function quantity(value: number | null): string {
  return value === null ? "—" : formatQuantity(value);
}

/**
 * The five quantity columns.
 *
 * Asked for, authorised, picked, shipped, received: five different facts, and
 * the gaps between them are what every service-level KPI is computed from. A
 * single "quantity" column would make a partial shipment unrepresentable.
 */
export function RequestLines({ lines }: RequestLinesProps) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reference</TableHead>
            <TableHead>Designation</TableHead>
            <TableNumericHead>VPE</TableNumericHead>
            <TableNumericHead>Preconisee</TableNumericHead>
            <TableNumericHead>Demandee</TableNumericHead>
            <TableNumericHead>Validee</TableNumericHead>
            <TableNumericHead>Preparee</TableNumericHead>
            <TableNumericHead>Expediee</TableNumericHead>
            <TableNumericHead>Recue</TableNumericHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="font-medium whitespace-nowrap">{line.reference}</TableCell>
              <TableCell className="max-w-56 truncate" title={line.designation}>
                {line.designation}
              </TableCell>
              <TableNumericCell className="text-foreground-muted">
                {formatQuantity(line.vpeSnapshot)}
              </TableNumericCell>
              <TableNumericCell className="text-foreground-subtle">
                {quantity(line.suggestedQuantity)}
              </TableNumericCell>
              <TableNumericCell className="font-medium">
                {formatQuantity(line.requestedQuantity)}
              </TableNumericCell>
              <TableNumericCell>{quantity(line.approvedQuantity)}</TableNumericCell>
              <TableNumericCell>{quantity(line.preparedQuantity)}</TableNumericCell>
              <TableNumericCell>{quantity(line.shippedQuantity)}</TableNumericCell>
              <TableNumericCell
                className={
                  line.receivedQuantity !== null &&
                  line.shippedQuantity !== null &&
                  line.receivedQuantity < line.shippedQuantity
                    ? "font-medium text-status-critical"
                    : undefined
                }
                title={
                  line.receivedQuantity !== null &&
                  line.shippedQuantity !== null &&
                  line.receivedQuantity < line.shippedQuantity
                    ? "Ecart entre la quantite expediee et la quantite recue"
                    : undefined
                }
              >
                {quantity(line.receivedQuantity)}
              </TableNumericCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
