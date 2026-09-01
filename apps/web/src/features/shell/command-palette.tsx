"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { Role } from "@leoni/core";
import { Button, cn, Dialog, Input } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { navigationFor } from "./navigation";

interface Entry {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
}

/**
 * Ctrl/Cmd-K: jump to a section, or straight to a request by its code.
 *
 * Built on `Dialog` and a filtered list rather than on `cmdk`. The whole
 * behaviour is a text input, a substring match and arrow keys — about a
 * hundred lines against a dependency, and the dependency would still need
 * styling to match everything else here.
 *
 * The section list comes from `navigationFor(role)`, the same source as the
 * sidebar, so the palette cannot offer a screen the server would refuse.
 */
export function CommandPalette({ role }: { readonly role: Role }) {
  const router = useRouter();
  const trpc = useTRPC();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Only queried while the palette is open and something has been typed: a
  // background request list on every page load would be a poor trade for a
  // shortcut most sessions never use.
  const requests = useQuery({
    ...trpc.request.list.queryOptions({
      limit: 5,
      onlyMine: false,
      onlyLate: false,
      ...(query === "" ? {} : { search: query }),
    }),
    enabled: open,
  });

  const sections: Entry[] = navigationFor(role).map((item) => ({
    href: item.href,
    label: item.label,
    hint: "Section",
  }));

  const matches = query === "" ? "" : query.toLowerCase();

  const entries: Entry[] = [
    ...sections.filter((entry) => entry.label.toLowerCase().includes(matches)),
    ...(requests.data?.items ?? []).map((request) => ({
      href: `/demandes/${request.id}`,
      label: request.code,
      hint: `Demande — ${request.createdByName}`,
    })),
  ];

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden gap-2 text-foreground-muted md:inline-flex"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Search />
        Rechercher
        <kbd className="rounded border border-border-strong px-1 text-xs">Ctrl K</kbd>
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Aller a"
        description="Une section, ou une demande par son code."
      >
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Tableau de bord, DR-2026-0042..."
            aria-label="Rechercher une section ou une demande"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((previous) => Math.min(previous + 1, entries.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((previous) => Math.max(previous - 1, 0));
              }
              if (event.key === "Enter") {
                const entry = entries[highlighted];
                if (entry !== undefined) go(entry.href);
              }
            }}
          />

          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground-muted">Aucun resultat.</p>
          ) : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {entries.map((entry, index) => (
                <li key={entry.href}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm",
                      index === highlighted ? "bg-primary-subtle text-primary" : "hover:bg-surface-sunken",
                    )}
                    onMouseEnter={() => {
                      setHighlighted(index);
                    }}
                    onClick={() => {
                      go(entry.href);
                    }}
                  >
                    <span className="font-medium">{entry.label}</span>
                    <span className="text-xs text-foreground-muted">{entry.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </>
  );
}
