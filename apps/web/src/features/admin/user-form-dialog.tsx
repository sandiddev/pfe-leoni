"use client";

import { useMutation } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type ProvisionedCredentials, ROLE_LABELS_FR, type SiteOption } from "@leoni/contracts";
import { isCrossSiteRole, isRole, type Role, ROLES } from "@leoni/core";
import { Button, Dialog, Field, Input, Select, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface UserFormDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly sites: readonly SiteOption[];
}

/**
 * Provisioning an account.
 *
 * There is no password field: the server generates one and returns it once.
 * The dialog then switches to showing it, and stays open until the
 * Administrator dismisses it — closing automatically would throw away the only
 * copy that will ever exist.
 */
export function UserFormDialog({ open, onClose, sites }: UserFormDialogProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("LTN1_STOREKEEPER");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [credentials, setCredentials] = useState<ProvisionedCredentials | null>(null);

  const spansBothPlants = isCrossSiteRole(role);

  const create = useMutation(
    trpc.admin.users.create.mutationOptions({
      onSuccess: (result) => {
        setCredentials(result);
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Creation refusee", cause.message);
      },
    }),
  );

  const copy = () => {
    if (credentials === null) return;

    navigator.clipboard
      .writeText(credentials.password)
      .then(() => {
        toast.success("Mot de passe copie");
      })
      .catch(() => {
        // Clipboard access can be refused outright; the password is on screen
        // anyway, so this is a convenience failing, not the operation.
        toast.error("Copie impossible", "Selectionnez le mot de passe a l ecran.");
      });
  };

  if (credentials !== null) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Compte cree"
        description="Notez ce mot de passe maintenant : il n est stocke nulle part et ne pourra pas etre reaffiche."
        footer={
          <Button onClick={onClose}>J ai note le mot de passe</Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm text-foreground-muted">{credentials.email}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border-strong bg-surface-sunken px-3 py-2 font-mono text-base tracking-wider">
                {credentials.password}
              </code>
              <Button variant="outline" size="icon" aria-label="Copier" onClick={copy}>
                <Copy />
              </Button>
            </div>
          </div>

          <p className="rounded-md bg-status-warning-subtle px-3 py-2 text-sm text-status-warning">
            Transmettez-le a la personne concernee et demandez-lui de le changer. En cas de perte,
            utilisez « Reinitialiser le mot de passe » pour en generer un nouveau.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvel utilisateur"
      description="Le mot de passe est genere par le serveur et affiche une seule fois."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Annuler
          </Button>
          <Button
            disabled={create.isPending}
            onClick={() => {
              if (name.trim().length < 2 || !email.includes("@")) {
                toast.error("Saisie incomplete", "Un nom et une adresse e-mail valide sont requis.");
                return;
              }
              create.mutate({
                name,
                email,
                role,
                siteId: spansBothPlants ? null : siteId,
              });
            }}
          >
            <KeyRound />
            {create.isPending ? "Creation..." : "Creer le compte"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nom complet" required>
          {(props) => (
            <Input
              {...props}
              value={name}
              placeholder="Sami Ben Ali"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Adresse e-mail" required description="Sert d identifiant de connexion.">
          {(props) => (
            <Input
              {...props}
              type="email"
              value={email}
              placeholder="prenom.nom@leoni.tn"
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Role" required description="Decide des ecrans et des actions accessibles.">
          {(props) => (
            <Select
              {...props}
              value={role}
              onChange={(event) => {
                const next = event.target.value;
                setRole(isRole(next) ? next : "LTN1_STOREKEEPER");
              }}
            >
              {ROLES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {ROLE_LABELS_FR[candidate]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {!spansBothPlants && (
          <Field
            label="Site"
            required
            description="Un role rattache a un site ne voit que les donnees de ce site."
          >
            {(props) => (
              <Select
                {...props}
                value={siteId}
                onChange={(event) => {
                  setSiteId(event.target.value);
                }}
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.code} — {site.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
