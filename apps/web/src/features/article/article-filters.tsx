"use client";

import { Search } from "lucide-react";

import { ALERT_LEVEL_LABELS_FR } from "@leoni/contracts";
import type { AlertLevel } from "@leoni/core";
import { Button, Input } from "@leoni/ui";

export interface ArticleFiltersProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly alertLevel: AlertLevel | "ALL";
  readonly onAlertLevelChange: (value: AlertLevel | "ALL") => void;
  readonly onlyReplenishable: boolean;
  readonly onOnlyReplenishableChange: (value: boolean) => void;
}

const ALERT_FILTERS: readonly (AlertLevel | "ALL")[] = [
  "ALL",
  "RUPTURE",
  "CRITICAL",
  "WARNING",
  "NORMAL",
];

/** Presentational: every value and handler comes from the owning table. */
export function ArticleFilters({
  search,
  onSearchChange,
  alertLevel,
  onAlertLevelChange,
  onlyReplenishable,
  onOnlyReplenishableChange,
}: ArticleFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
        <Input
          className="pl-8"
          placeholder="Rechercher une reference ou une designation"
          aria-label="Rechercher un article"
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
        />
      </div>

      <div
        className="flex items-center gap-1"
        role="group"
        aria-label="Filtrer par niveau d alerte"
      >
        {ALERT_FILTERS.map((level) => (
          <Button
            key={level}
            size="sm"
            variant={alertLevel === level ? "primary" : "outline"}
            aria-pressed={alertLevel === level}
            onClick={() => {
              onAlertLevelChange(level);
            }}
          >
            {level === "ALL" ? "Tous" : ALERT_LEVEL_LABELS_FR[level]}
          </Button>
        ))}
      </div>

      <Button
        size="sm"
        variant={onlyReplenishable ? "primary" : "outline"}
        aria-pressed={onlyReplenishable}
        onClick={() => {
          onOnlyReplenishableChange(!onlyReplenishable);
        }}
      >
        A reapprovisionner
      </Button>
    </div>
  );
}
