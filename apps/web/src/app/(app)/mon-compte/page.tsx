import type { Metadata } from "next";

import { ROLE_LABELS_FR } from "@leoni/contracts";
import { Card, CardContent, PageHeader } from "@leoni/ui";
import { PasswordForm } from "~/features/account/password-form";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Mon compte" };

/**
 * The signed-in user's own account.
 *
 * Read-only above the password form, and deliberately so: `role` and `siteId`
 * are declared `input: false` in the better-auth configuration precisely so a
 * user cannot grant themselves a role by editing a request body. Showing them
 * here without an edit control is the honest rendering of that rule — the
 * Administrator changes them, through the administration module.
 */
export default async function MonComptePage() {
  const actor = await api.session.me();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mon compte"
        description="Vos informations et votre mot de passe. Le role et le site sont attribues par l administrateur."
      />

      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-foreground-muted">Nom</dt>
              <dd className="text-sm font-medium">{actor.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-foreground-muted">Adresse e-mail</dt>
              <dd className="text-sm font-medium">{actor.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-foreground-muted">Role</dt>
              <dd className="text-sm font-medium">{ROLE_LABELS_FR[actor.role]}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <PasswordForm />
    </div>
  );
}
