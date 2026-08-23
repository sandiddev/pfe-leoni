import {
  Bell,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Settings,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { can, type Permission, type Role } from "@leoni/core";

/**
 * The navigation map.
 *
 * Each entry declares the permission it requires, and the sidebar filters
 * itself from the same `can()` the API uses to authorise the call. The result
 * is that a user is never shown a link to a screen that would refuse them —
 * and, more importantly, that hiding a link is never mistaken for securing it.
 * The server checks again on every request regardless.
 *
 * Routes are French, matching the interface language; the identifiers stay in
 * English like the rest of the code (brief section 6.2).
 */
export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission: Permission;
}

export const NAVIGATION: readonly NavigationItem[] = [
  {
    href: "/tableau-de-bord",
    label: "Tableau de bord",
    icon: LayoutDashboard,
    permission: "dashboard:read",
  },
  { href: "/alertes", label: "Alertes", icon: TriangleAlert, permission: "alert:read" },
  { href: "/articles", label: "Articles", icon: Package, permission: "article:read" },
  { href: "/stock", label: "Stock et mouvements", icon: Boxes, permission: "stock:read" },
  { href: "/demandes", label: "Demandes", icon: ClipboardList, permission: "request:read" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "alert:read" },
  { href: "/parametres", label: "Parametres", icon: Settings, permission: "parameter:read" },
  { href: "/administration", label: "Administration", icon: ShieldCheck, permission: "user:read" },
];

export function navigationFor(role: Role): readonly NavigationItem[] {
  return NAVIGATION.filter((item) => can(role, item.permission));
}
