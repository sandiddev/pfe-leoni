"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@leoni/core";
import { cn } from "@leoni/ui";

import { navigationFor } from "./navigation";

/**
 * Primary navigation.
 *
 * A client component only because it needs `usePathname` to mark the current
 * section. The list it renders is decided on the server from the role, so no
 * link a user may not follow is ever sent to the browser.
 */
export function AppSidebar({ role }: { readonly role: Role }) {
  const pathname = usePathname();
  const items = navigationFor(role);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-foreground-on-primary">
          L
        </span>
        <span className="text-sm leading-tight font-semibold">
          LEONI
          <span className="block text-xs font-normal text-foreground-muted">
            Reapprovisionnement
          </span>
        </span>
      </div>

      <nav aria-label="Navigation principale" className="flex-1 space-y-0.5 p-3">
        {items.map((item) => {
          // Prefix match so a detail page keeps its section highlighted, but
          // guarded against "/stock" also matching "/stockage".
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
    </aside>
  );
}
