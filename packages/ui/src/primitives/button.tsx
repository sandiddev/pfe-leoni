import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/**
 * Button.
 *
 * Variants are named by intent, not by colour: `destructive` rather than `red`.
 * When a screen needs a button that cancels a request, it asks for the
 * destructive intent and the design system decides what that looks like — which
 * is what keeps every irreversible action in the application looking alike.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap",
    "transition-colors disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-foreground-on-primary hover:bg-primary-hover",
        secondary: "bg-surface-sunken text-foreground hover:bg-border",
        outline: "border border-border-strong bg-surface text-foreground hover:bg-surface-sunken",
        ghost: "text-foreground hover:bg-surface-sunken",
        destructive: "bg-destructive text-foreground-on-primary hover:bg-destructive-hover",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /**
   * Renders the child element instead of a `<button>`, keeping the styling.
   * Used to style a Next.js `<Link>` as a button without nesting an anchor
   * inside a button, which is invalid HTML and breaks keyboard navigation.
   */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";

  return (
    <Component
      // A button inside a form defaults to `submit`, which has surprised
      // everyone at least once. Anything not explicitly a submit is a button.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
