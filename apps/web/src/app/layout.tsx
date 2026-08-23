import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

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
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // The interface is French (brief section 6.2). Declaring it on <html> is
    // what makes screen readers pronounce it correctly and browsers offer the
    // right spellcheck dictionary.
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
