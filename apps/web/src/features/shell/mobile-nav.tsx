"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import type { Role } from "@leoni/core";
import { Button, Dialog } from "@leoni/ui";

import { SidebarNav } from "./sidebar-nav";

/**
 * The same navigation, in a drawer, below `lg`.
 *
 * Reusing `Dialog` rather than adding a sheet primitive: a drawer is a modal
 * that happens to be full-height, and the focus trapping and Escape handling
 * are identical. The one thing it needs is to sit against the left edge, which
 * `className` covers.
 */
export function MobileNav({ role }: { readonly role: Role }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Ouvrir la navigation"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Menu />
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Navigation"
        description="Sections accessibles avec votre role."
        className="top-0 left-0 h-dvh max-h-dvh w-72 translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0"
      >
        <SidebarNav
          role={role}
          onNavigate={() => {
            setOpen(false);
          }}
        />
      </Dialog>
    </>
  );
}
