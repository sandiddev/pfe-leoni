import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { Toaster, TooltipProvider } from "@leoni/ui";
import { ThemeScript } from "~/features/theme/theme-script";
import { TRPCReactProvider } from "~/trpc/client";

import "~/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Reapprovisionnement LTN1 / LTN4",
    template: "%s — Reapprovisionnement LEONI",
  },
  description:
    "Systeme de gestion et de reapprovisionnement des stocks entre les sites LTN1 et LTN4.",
  // The application runs on the LEONI internal network and must never be
  // indexed, even if a host is briefly reachable from outside.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * The colour of the browser's own chrome around the page.
   *
   * Without it a phone or tablet keeps a white address bar above a dark
   * application, which is the detail that makes a dark theme look bolted on.
   * The values match `--color-background` in each theme; they are literals
   * because this is a `<meta>` tag, which cannot read a CSS custom property.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(0.985 0.002 250)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.13 0.006 250)" },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // The interface is French (brief section 6.2). Declaring it on <html> is
    // what makes screen readers pronounce it correctly and browsers offer the
    // right spellcheck dictionary.
    <html lang="fr" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {/* Keyboard users reach the content without tabbing the whole sidebar.
            Visible only once focused, which is the point. */}
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-foreground-on-primary"
        >
          Aller au contenu
        </a>

        <TRPCReactProvider>
          <TooltipProvider>
            <Toaster>{children}</Toaster>
          </TooltipProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
