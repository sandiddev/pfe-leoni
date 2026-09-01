"use client";

import { useEffect } from "react";

/**
 * The last boundary: a failure in the root layout itself.
 *
 * It replaces `<html>`, so it can use no provider, no design-system component
 * and no stylesheet — by the time this renders, the tree that would have
 * supplied them is the thing that failed. Hence the inline styles, which are
 * the one place in this repository they are correct.
 *
 * `color-scheme: light dark` plus the CSS system colours is what gives this
 * page a dark mode without a stylesheet: `Canvas` and `CanvasText` are the
 * browser's own document colours, and they already follow the user's setting.
 * Hard-coding white here would flash a white page at somebody whose entire
 * session has been dark.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error("Root boundary caught:", error);
  }, [error]);

  return (
    <html lang="fr" style={{ colorScheme: "light dark" }}>
      <body
        style={{
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>L application n a pas demarre</h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
            Rechargez la page. Si l erreur persiste, contactez l administrateur.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              cursor: "pointer",
              backgroundColor: "ButtonFace",
              color: "ButtonText",
              border: "1px solid ButtonBorder",
              borderRadius: "0.375rem",
            }}
          >
            Reessayer
          </button>
        </div>
      </body>
    </html>
  );
}
