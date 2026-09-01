"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { authClient } from "@leoni/auth/client";
import { Button, Card, CardContent, Input, Label, useToast } from "@leoni/ui";

/** Matches `minPasswordLength` in the better-auth configuration. */
const MINIMUM_LENGTH = 8;

/**
 * Changing your own password.
 *
 * Until now the only way to change a password was for an Administrator to reset
 * it, which hands somebody else's secret to a third person over whatever channel
 * they use to pass it on — and means a user who suspects their password is known
 * has to ask permission to fix it.
 *
 * `revokeOtherSessions` is on. Changing a password is what somebody does when
 * they think a session is not theirs, and leaving those sessions alive makes the
 * act pointless. The current session survives, so the user is not signed out of
 * the tab they are looking at.
 */
export function PasswordForm() {
  const toast = useToast();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirmation !== "" && next !== confirmation;
  const tooShort = next !== "" && next.length < MINIMUM_LENGTH;
  const cannotSubmit =
    isSubmitting || current === "" || next.length < MINIMUM_LENGTH || next !== confirmation;

  async function change(): Promise<void> {
    setIsSubmitting(true);

    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });

    setIsSubmitting(false);

    if (error !== null) {
      // The server distinguishes a wrong current password from a rejected new
      // one; both are the user's own account, so saying which is safe and
      // saves a guess.
      toast.error(
        "Changement refuse",
        "Mot de passe actuel incorrect, ou nouveau mot de passe refuse.",
      );
      return;
    }

    setCurrent("");
    setNext("");
    setConfirmation("");
    toast.success(
      "Mot de passe modifie",
      "Vos autres sessions ont ete fermees. Cette session reste ouverte.",
    );
  }

  return (
    <Card>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void change();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Mot de passe actuel</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => {
                setCurrent(event.target.value);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">
              Nouveau mot de passe ({MINIMUM_LENGTH} caracteres minimum)
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => {
                setNext(event.target.value);
              }}
            />
            {tooShort && (
              <p className="text-xs text-status-critical">{MINIMUM_LENGTH} caracteres minimum.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirmer le nouveau mot de passe</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
            />
            {mismatch && (
              <p className="text-xs text-status-critical">Les deux saisies ne correspondent pas.</p>
            )}
          </div>

          <Button type="submit" disabled={cannotSubmit}>
            {isSubmitting && <LoaderCircle className="animate-spin" />}
            {isSubmitting ? "Enregistrement..." : "Changer le mot de passe"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
