"use client";

import { useState } from "react";

import { ABC_CLASS_LABELS_FR, type ParameterItem } from "@leoni/contracts";
import { AVERAGING_WINDOWS } from "@leoni/core";
import { Badge, Button, Input, Select, TableCell, TableRow } from "@leoni/ui";

export interface ParameterRowProps {
  readonly parameter: ParameterItem;
  readonly canEdit: boolean;
  readonly isSaving: boolean;
  readonly onSave: (values: {
    readonly safetyDays: number;
    readonly extraCoverageDays: number;
    readonly averagingWindowDays: 7 | 30 | 90;
    readonly warningMarginRatio: number;
  }) => void;
}

/**
 * One ABC class, editable in place.
 *
 * The row owns its draft state so that editing class A does not make the other
 * two rows re-render, and so an abandoned edit does not leak into the next one.
 */
export function ParameterRow({ parameter, canEdit, isSaving, onSave }: ParameterRowProps) {
  const [safetyDays, setSafetyDays] = useState(String(parameter.safetyDays));
  const [extraCoverageDays, setExtraCoverageDays] = useState(String(parameter.extraCoverageDays));
  const [window, setWindow] = useState(parameter.averagingWindowDays);
  const [marginPercent, setMarginPercent] = useState(
    String(Math.round(parameter.warningMarginRatio * 100)),
  );

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        <span className="font-medium">{ABC_CLASS_LABELS_FR[parameter.abcClass]}</span>
        {parameter.isDefault && (
          <Badge variant="outline" className="ml-2">
            Valeur par defaut
          </Badge>
        )}
      </TableCell>

      <TableCell className="w-28">
        <Input
          type="number"
          min={0}
          step={0.5}
          aria-label={`Jours de securite, classe ${parameter.abcClass}`}
          disabled={!canEdit}
          value={safetyDays}
          onChange={(event) => {
            setSafetyDays(event.target.value);
          }}
        />
      </TableCell>

      <TableCell className="w-28">
        <Input
          type="number"
          min={0}
          step={0.5}
          aria-label={`Couverture additionnelle, classe ${parameter.abcClass}`}
          disabled={!canEdit}
          value={extraCoverageDays}
          onChange={(event) => {
            setExtraCoverageDays(event.target.value);
          }}
        />
      </TableCell>

      <TableCell className="w-32">
        <Select
          aria-label={`Fenetre de moyenne, classe ${parameter.abcClass}`}
          disabled={!canEdit}
          value={String(window)}
          onChange={(event) => {
            const next = AVERAGING_WINDOWS.find(
              (candidate) => String(candidate) === event.target.value,
            );
            setWindow(next ?? 30);
          }}
        >
          {AVERAGING_WINDOWS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate} jours
            </option>
          ))}
        </Select>
      </TableCell>

      <TableCell className="w-28">
        <Input
          type="number"
          min={0}
          max={100}
          step={5}
          aria-label={`Marge d alerte en pourcentage, classe ${parameter.abcClass}`}
          disabled={!canEdit}
          value={marginPercent}
          onChange={(event) => {
            setMarginPercent(event.target.value);
          }}
        />
      </TableCell>

      <TableCell className="text-right">
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            disabled={isSaving}
            onClick={() => {
              onSave({
                safetyDays: Number(safetyDays),
                extraCoverageDays: Number(extraCoverageDays),
                averagingWindowDays: window === 7 || window === 90 ? window : 30,
                warningMarginRatio: Number(marginPercent) / 100,
              });
            }}
          >
            Enregistrer
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
