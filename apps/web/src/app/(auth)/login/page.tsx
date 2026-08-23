import type { Metadata } from "next";

import { LoginForm } from "~/features/auth/login-form";

export const metadata: Metadata = { title: "Connexion" };

/**
 * The only unauthenticated screen in the application.
 *
 * There is no sign-up link: accounts are created by the Administrator
 * (brief section 4), so offering registration here would advertise a door that
 * does not exist.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <header className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary text-lg font-bold text-foreground-on-primary">
            L
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Reapprovisionnement LEONI</h1>
          <p className="text-sm text-foreground-muted">
            Gestion des flux de stock entre LTN1 et LTN4
          </p>
        </header>

        <LoginForm />

        <p className="text-center text-xs text-foreground-subtle">
          Acces reserve au personnel LEONI. Contactez l administrateur pour obtenir un compte.
        </p>
      </div>
    </main>
  );
}
