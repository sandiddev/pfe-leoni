"use client";

import { Copy } from "lucide-react";

import type { ProvisionedCredentials } from "@leoni/contracts";
import { Button, Dialog, useToast } from "@leoni/ui";

export interface PasswordDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly credentials: ProvisionedCredentials;
}

/**
 * The one moment a generated password is readable.
 *
 * It is not stored, not in the audit trail, and not recoverable — a second
 * reset is the only way to get another one. So this dialog does not
 * auto-dismiss and has no cancel: the only way out is acknowledging it.
 */
export function PasswordDialog({ open, onClose, credentials }: PasswordDialogProps) {
  const toast = useToast();

  const copy = () => {
    navigator.clipboard
      .writeText(credentials.password)
      .then(() => {
        toast.success("Mot de passe copie");
      })
      .catch(() => {
        toast.error("Copie impossible", "Selectionnez le mot de passe a l ecran.");
      });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouveau mot de passe"
      description="Notez-le maintenant : il n est stocke nulle part et ne pourra pas etre reaffiche."
      footer={<Button onClick={onClose}>J ai note le mot de passe</Button>}
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
          Toutes les sessions ouvertes de ce compte ont ete fermees. La personne devra se
          reconnecter avec ce mot de passe.
        </p>
      </div>
    </Dialog>
  );
}
