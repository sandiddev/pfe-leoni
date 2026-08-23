"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { authClient } from "@leoni/auth/client";
import { ROLE_LABELS_FR } from "@leoni/contracts";
import { isRole, type Role } from "@leoni/core";
import { Button } from "@leoni/ui";

export interface AppTopbarProps {
  readonly userName: string;
  /** Arrives from the session as a plain string. */
  readonly role: string;
}

/**
 * The header strip: who is signed in, in what role, and how to leave.
 *
 * Showing the role is not decoration. Five people share the same screens and
 * see different actions on them, and "why can I not approve this?" is answered
 * instantly by a label that says "Magasinier LTN1".
 */
export function AppTopbar({ userName, role }: AppTopbarProps) {
  const router = useRouter();
  const typedRole: Role | null = isRole(role) ? role : null;

  async function handleSignOut(): Promise<void> {
    await authClient.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
      <div className="min-w-0" />

      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="truncate text-xs text-foreground-muted">
            {typedRole === null ? "Role inconnu" : ROLE_LABELS_FR[typedRole]}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Se deconnecter"
          onClick={() => {
            void handleSignOut();
          }}
        >
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
