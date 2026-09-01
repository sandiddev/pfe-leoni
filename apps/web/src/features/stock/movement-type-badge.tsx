import { MOVEMENT_TYPE_LABELS_FR } from "@leoni/contracts";
import type { MovementType } from "@leoni/core";
import { Badge, type BadgeProps } from "@leoni/ui";

/**
 * Inbound reads as normal, outbound as active, a correction as a warning.
 *
 * Three tones rather than five: the question a reader asks scanning a journal
 * is "did stock arrive, leave, or was it overridden", and the exact type is
 * written out in words next to the colour anyway.
 */
const TONE_BY_TYPE: Readonly<Record<MovementType, NonNullable<BadgeProps["variant"]>>> = {
  ENTRY: "normal",
  TRANSFER_IN: "normal",
  EXIT: "active",
  TRANSFER_OUT: "active",
  ADJUSTMENT: "warning",
};

export interface MovementTypeBadgeProps {
  readonly type: MovementType;
}

export function MovementTypeBadge({ type }: MovementTypeBadgeProps) {
  return <Badge variant={TONE_BY_TYPE[type]}>{MOVEMENT_TYPE_LABELS_FR[type]}</Badge>;
}
