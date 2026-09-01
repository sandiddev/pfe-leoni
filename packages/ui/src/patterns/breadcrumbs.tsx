import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface Crumb {
  readonly label: string;
  /** Omitted on the last crumb, which is the current page. */
  readonly href?: string;
}

export interface BreadcrumbsProps {
  readonly items: readonly Crumb[];
  /** Injected so the design system stays free of a router dependency. */
  readonly renderLink: (href: string, label: string) => ReactNode;
}

/**
 * Where you are, and how to get back one level.
 *
 * The link renderer is a prop because `@leoni/ui` must not import `next/link` —
 * the package is framework-agnostic by rule, and the one thing this component
 * needs from the framework is exactly one function.
 */
export function Breadcrumbs({ items, renderLink }: BreadcrumbsProps) {
  return (
    <nav aria-label="Fil d Ariane">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-foreground-muted">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={crumb.label} className="flex items-center gap-1">
              {crumb.href === undefined || isLast ? (
                <span
                  className={isLast ? "font-medium text-foreground" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              ) : (
                renderLink(crumb.href, crumb.label)
              )}

              {!isLast && <ChevronRight className="size-3.5 text-foreground-subtle" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
