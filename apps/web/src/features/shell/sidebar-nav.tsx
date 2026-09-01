"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@leoni/core";
import { cn } from "@leoni/ui";

import { navigationFor } from "./navigation";

export interface SidebarNavProps {
  readonly role: Role;
  /** Closes the mobile drawer after a link is followed. */
  readonly onNavigate?: () => void;
}

/**
 * The navigation list itself, without any chrome.
 *
 * Extracted so the desktop rail and the mobile drawer render exactly the same
 * links from exactly the same `navigationFor(role)` — two copies would be two
 * places for a new section to be forgotten.
 */
export function SidebarNav({ role, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale" className="flex-1 space-y-0.5 p-3">
      {navigationFor(role).map((item) => {
        // Prefix match so a detail page keeps its section highlighted, but
        // guarded against "/stock" also matching "/stockage".
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              isActive
                ? "bg-primary-subtle text-primary"
                : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The LEONI mark, shared by the rail and the drawer. */
export function SidebarBrand() {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-foreground-on-primary">
        L
      </span>
      <span className="text-sm leading-tight font-semibold">
        LEONI
        <span className="block text-xs font-normal text-foreground-muted">Reapprovisionnement</span>
      </span>
    </div>
  );
}
