"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Breadcrumbs, type Crumb } from "@leoni/ui";

import { NAVIGATION } from "./navigation";

/**
 * Wording for the path segments that are not a navigation entry.
 *
 * A segment with no entry here falls back to the raw value, which is right for
 * an identifier: `/demandes/abc123` should read "Demandes / abc123" rather than
 * inventing a label for a row this component cannot see.
 */
const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  nouvelle: "Nouvelle",
};

/**
 * Where you are, derived from the route and the navigation map.
 *
 * Not a per-page prop: a breadcrumb that each screen has to remember to pass is
 * a breadcrumb that is wrong on the screen somebody added last.
 */
export function AppBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length === 0) return null;

  const crumbs: Crumb[] = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const section = NAVIGATION.find((item) => item.href === href);

    return {
      label: section?.label ?? SEGMENT_LABELS[segment] ?? segment,
      href,
    };
  });

  return (
    <Breadcrumbs
      items={crumbs}
      renderLink={(href, label) => (
        <Link href={href} className="transition-colors hover:text-foreground">
          {label}
        </Link>
      )}
    />
  );
}
