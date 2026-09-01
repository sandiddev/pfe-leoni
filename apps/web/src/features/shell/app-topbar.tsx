"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { authClient } from "@leoni/auth/client";
import { ROLE_LABELS_FR } from "@leoni/contracts";
import { isRole, type Role } from "@leoni/core";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@leoni/ui";
import { NotificationBell } from "~/features/notification/notification-bell";
import { ThemeToggle } from "~/features/theme/theme-toggle";

import { AppBreadcrumbs } from "./app-breadcrumbs";
import { CommandPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";

export interface AppTopbarProps {
  readonly userName: string;
  readonly email: string;
  /** Arrives from the session as a plain string. */
  readonly role: string;
}

/**
 * The header strip.
 *
 * Showing the role is not decoration. Five people share the same screens and
 * see different actions on them, and "why can I not approve this?" is answered
 * instantly by a label that says "Magasinier LTN1".
 */
export function AppTopbar({ userName, email, role }: AppTopbarProps) {
  const router = useRouter();
  const typedRole: Role | null = isRole(role) ? role : null;

  async function handleSignOut(): Promise<void> {
    await authClient.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {typedRole !== null && <MobileNav role={typedRole} />}
        <div className="hidden min-w-0 sm:block">
          <AppBreadcrumbs />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {typedRole !== null && <CommandPalette role={typedRole} />}
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2" aria-label="Menu du compte">
              <Avatar name={userName} />
              <span className="hidden text-left leading-tight sm:block">
                <span className="block truncate text-sm font-medium">{userName}</span>
                <span className="block truncate text-xs text-foreground-muted">
                  {typedRole === null ? "Role inconnu" : ROLE_LABELS_FR[typedRole]}
                </span>
              </span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent>
            <DropdownMenuLabel>
              <span className="block text-sm font-medium text-foreground">{userName}</span>
              <span className="block font-normal">{email}</span>
            </DropdownMenuLabel>

            <ThemeToggle />

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void handleSignOut();
              }}
            >
              <LogOut />
              Se deconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
