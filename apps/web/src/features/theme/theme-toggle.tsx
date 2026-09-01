"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@leoni/ui";

const STORAGE_KEY = "leoni-theme";
const CHANGE_EVENT = "leoni-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** What the user chose. "system" is a preference, not a colour. */
type Preference = "light" | "dark" | "system";

const OPTIONS = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Systeme", icon: Monitor },
] as const;

function isPreference(value: string | null): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Writes the resolved theme onto the document.
 *
 * `data-theme` is always one of the two real themes, never "system": the
 * stylesheet has one dark block and no media query, so somebody has to do the
 * resolving, and doing it here means it happens in exactly one place.
 */
function apply(preference: Preference): void {
  const resolved = preference === "system" ? systemTheme() : preference;
  document.documentElement.setAttribute("data-theme", resolved);

  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage refused: the theme still applies for this page. Not worth a toast.
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * The preference is read from storage, not from the DOM.
 *
 * `data-theme` holds the *resolved* theme, so it cannot distinguish "I chose
 * dark" from "my system is dark" — and the menu has to show which of the three
 * is ticked.
 */
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);

  // While the preference is "system", the operating system changing at dusk has
  // to move the page with it. Without this listener the resolved theme would be
  // whatever it was at page load until the next navigation.
  const onSystemChange = () => {
    if (localStorage.getItem(STORAGE_KEY) === null) {
      document.documentElement.setAttribute("data-theme", systemTheme());
    }
    onChange();
  };

  window.addEventListener(CHANGE_EVENT, onChange);
  // Another tab changing the preference should move this one too.
  window.addEventListener("storage", onSystemChange);
  media.addEventListener("change", onSystemChange);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onSystemChange);
    media.removeEventListener("change", onSystemChange);
  };
}

function getSnapshot(): Preference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function getServerSnapshot(): Preference {
  return "system";
}

/**
 * Theme choice, as items inside the account menu.
 *
 * A warehouse floor is bright and a night-shift office is not. Three options
 * rather than a two-state switch, because "follow my machine" is a real answer
 * and a toggle cannot express it.
 */
export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Apparence</DropdownMenuLabel>

      {OPTIONS.map((option) => {
        const Icon = option.icon;

        return (
          <DropdownMenuItem
            key={option.value}
            onSelect={(event) => {
              // Keeps the menu open, so the three can be compared without
              // reopening it each time.
              event.preventDefault();
              apply(option.value);
            }}
          >
            <Icon />
            {option.label}
            {preference === option.value && (
              <span className="ml-auto text-xs text-primary" aria-label="Selectionne">
                ●
              </span>
            )}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
