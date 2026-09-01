import type { Role } from "@leoni/core";

import { SidebarBrand, SidebarNav } from "./sidebar-nav";

/**
 * The desktop navigation rail.
 *
 * Hidden below `lg`, where `MobileNav` in the top bar takes over. It used to be
 * hidden below `lg` with nothing replacing it, which left a tablet — the device
 * a storekeeper actually carries around a warehouse — with no navigation at all.
 */
export function AppSidebar({ role }: { readonly role: Role }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <SidebarBrand />
      <SidebarNav role={role} />
    </aside>
  );
}
