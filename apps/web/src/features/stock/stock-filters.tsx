"use client";

import { Search, X } from "lucide-react";

import { MOVEMENT_TYPE_LABELS_FR, type StorageLocationOption } from "@leoni/contracts";
import { MOVEMENT_TYPES, type MovementType } from "@leoni/core";
import { Button, Input, Select } from "@leoni/ui";

export interface StockFilterState {
  readonly search: string;
  readonly type: MovementType | "ALL";
  readonly storageLocationId: string;
  readonly from: string;
  readonly to: string;
}

export interface StockFiltersProps {
  readonly value: StockFilterState;
  readonly onChange: (next: StockFilterState) => void;
  readonly locations: readonly StorageLocationOption[];
}

export const EMPTY_STOCK_FILTERS: StockFilterState = {
  search: "",
  type: "ALL",
  storageLocationId: "",
  from: "",
  to: "",
};

export function isStockFiltered(value: StockFilterState): boolean {
  return (
    value.search !== "" ||
    value.type !== "ALL" ||
    value.storageLocationId !== "" ||
    value.from !== "" ||
    value.to !== ""
  );
}

/**
 * Every filter the journal API accepts.
 *
 * The date range and the location were in `stockMovementListInputSchema` from
 * the day it was written and had no control on screen — so "what moved on this
 * shelf last week", which is the question an inventory discrepancy starts with,
 * could not be asked.
 */
export function StockFilters({ value, onChange, locations }: StockFiltersProps) {
  const set = (patch: Partial<StockFilterState>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
        <Input
          className="pl-8"
          placeholder="Rechercher une reference ou une designation"
          aria-label="Rechercher un article dans le journal"
          value={value.search}
          onChange={(event) => {
            set({ search: event.target.value });
          }}
        />
      </div>

      <Select
        className="w-48"
        aria-label="Filtrer par type de mouvement"
        value={value.type}
        onChange={(event) => {
          const next = MOVEMENT_TYPES.find((candidate) => candidate === event.target.value);
          set({ type: next ?? "ALL" });
        }}
      >
        <option value="ALL">Tous les mouvements</option>
        {MOVEMENT_TYPES.map((movementType) => (
          <option key={movementType} value={movementType}>
            {MOVEMENT_TYPE_LABELS_FR[movementType]}
          </option>
        ))}
      </Select>

      <Select
        className="w-44"
        aria-label="Filtrer par emplacement"
        value={value.storageLocationId}
        onChange={(event) => {
          set({ storageLocationId: event.target.value });
        }}
      >
        <option value="">Tous les emplacements</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.code}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="date"
          className="w-40"
          aria-label="Depuis"
          value={value.from}
          onChange={(event) => {
            set({ from: event.target.value });
          }}
        />
        <span className="text-sm text-foreground-muted">au</span>
        <Input
          type="date"
          className="w-40"
          aria-label="Jusqu au"
          value={value.to}
          onChange={(event) => {
            set({ to: event.target.value });
          }}
        />
      </div>

      {isStockFiltered(value) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(EMPTY_STOCK_FILTERS);
          }}
        >
          <X />
          Effacer
        </Button>
      )}
    </div>
  );
}
