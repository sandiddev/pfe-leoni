"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@leoni/auth/client";
import { Button, Card, CardContent, Input, Label } from "@leoni/ui";

/**
 * Credentials sign-in.
 *
 * The error message is deliberately the same whether the address is unknown or
 * the password is wrong. Distinguishing them would let anyone with the URL
 * discover which LEONI addresses have accounts, and the storekeeper who
 * genuinely mistyped is helped just as well by one message.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Takes no event argument on purpose: React 19 deprecates the `FormEvent`
  // type, and the submit handler below already owns `preventDefault`. Keeping
  // this function event-free also makes it directly callable from a test.
  async function signIn(): Promise<void> {
    setError(null);
    setIsSubmitting(true);

    const result = await authClient.signIn.email({ email, password });

    if (result.error) {
      setError("Adresse e-mail ou mot de passe incorrect.");
      setIsSubmitting(false);
      return;
    }

    // `refresh` before `push` so the server re-renders the layout with the new
    // session; without it the shell would render for a signed-out user.
    router.refresh();
    router.push("/tableau-de-bord");
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              placeholder="prenom.nom@leoni.tn"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </div>

          {error !== null && (
            // `role="alert"` so the failure is announced rather than only shown.
            <p
              role="alert"
              className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" />}
            {isSubmitting ? "Connexion..." : "Se connecter"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
