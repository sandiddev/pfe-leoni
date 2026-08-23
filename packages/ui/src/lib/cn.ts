import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, resolving Tailwind conflicts in favour of the last one.
 *
 * Without `twMerge`, a component that hardcodes `px-4` and a caller that passes
 * `px-2` produce `px-4 px-2` and the winner depends on stylesheet order rather
 * than on intent. With it, the caller always wins, which is what makes a
 * `className` prop trustworthy.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
