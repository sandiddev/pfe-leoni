import { Avatar as AvatarPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/** First letters of the first two words: "Sami Ben Ali" reads as "SB". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export interface AvatarProps extends ComponentProps<typeof AvatarPrimitive.Root> {
  readonly name: string;
}

/**
 * The signed-in user, as initials.
 *
 * No photograph: there is no avatar upload in this application and inventing a
 * placeholder face for a factory account would be worse than two letters.
 */
export function Avatar({ name, className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-subtle",
        className,
      )}
      {...props}
    >
      <AvatarPrimitive.Fallback className="text-xs font-semibold text-primary">
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
