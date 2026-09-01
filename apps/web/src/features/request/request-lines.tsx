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
 * A stage that recorded less than the one before it.
 *
 * Highlighted at every stage, not only at receipt: now that each step can
 * record its own figure, a shortfall can appear as early as the approval. The
 * gap is the whole reason these are five columns rather than one, so it has to
 * be visible without subtracting two numbers by eye.
 *
 * `null` on either side is not a shortfall — it means the stage has not
 * happened yet, which is what the dash says.
 */
function isShortfall(value: number | null, previous: number | null): boolean {
  return value !== null && previous !== null && value < previous;
}

/** The cell props for a stage column, so the five read identically. */
function stageCell(value: number | null, previous: number | null, previousLabel: string) {
  const short = isShortfall(value, previous);

  return {
    className: short ? "font-medium text-status-critical" : undefined,
    title: short ? `Inferieure a la quantite ${previousLabel}` : undefined,
    children: quantity(value),
  };
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
              <TableNumericCell
                {...stageCell(line.approvedQuantity, line.requestedQuantity, "demandee")}
              />
              <TableNumericCell
                {...stageCell(line.preparedQuantity, line.approvedQuantity, "validee")}
              />
              <TableNumericCell
                {...stageCell(line.shippedQuantity, line.preparedQuantity, "preparee")}
              />
              <TableNumericCell
                {...stageCell(line.receivedQuantity, line.shippedQuantity, "expediee")}
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
