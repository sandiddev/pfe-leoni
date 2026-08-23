import { AlertTriangle, CircleAlert, CircleCheck, OctagonX } from "lucide-react";
import type { ComponentType } from "react";

import { ALERT_LEVEL_LABELS_FR } from "@leoni/contracts";
import type { AlertLevel } from "@leoni/core";

import { Badge, type BadgeProps } from "../primitives/badge";

/**
 * The single way an alert level is rendered anywhere in the application.
 *
 * Three things are decided here once — the French label, the token, and the
 * icon — instead of at every call site. That matters beyond tidiness: colour
 * alone does not convey severity to a colour-blind user, and a warehouse
 * monitor at an angle washes out hue long before it washes out shape. Pairing
 * each level with a distinct icon is what makes the board readable in the
 * conditions it is actually used in.
 */
const VARIANT_BY_LEVEL: Readonly<Record<AlertLevel, NonNullable<BadgeProps["variant"]>>> = {
  NORMAL: "normal",
  WARNING: "warning",
  CRITICAL: "critical",
  RUPTURE: "rupture",
};

const ICON_BY_LEVEL: Readonly<Record<AlertLevel, ComponentType<{ className?: string }>>> = {
  NORMAL: CircleCheck,
  WARNING: AlertTriangle,
  CRITICAL: CircleAlert,
  RUPTURE: OctagonX,
};

export interface AlertLevelBadgeProps {
  readonly level: AlertLevel;
  /** Hides the text, for dense table cells. The label stays available to screen readers. */
  readonly iconOnly?: boolean;
  readonly className?: string;
}

export function AlertLevelBadge({ level, iconOnly = false, className }: AlertLevelBadgeProps) {
  const Icon = ICON_BY_LEVEL[level];
  const label = ALERT_LEVEL_LABELS_FR[level];

  return (
    <Badge variant={VARIANT_BY_LEVEL[level]} className={className}>
      <Icon className="size-3.5" />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </Badge>
  );
}
