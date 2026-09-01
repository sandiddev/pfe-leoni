"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SITE_TYPE_LABELS_FR, type SiteItem } from "@leoni/contracts";
import { SITE_TYPES, type SiteType } from "@leoni/core";
import { Button, Dialog, Field, Input, Select, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface SiteFormDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Omitted to create; supplied to edit. */
  readonly site?: SiteItem;
}

export function SiteFormDialog({ open, onClose, site }: SiteFormDialogProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const isEdit = site !== undefined;
  // The type is frozen once any request references the plant, in either
  // direction: it is what decides which end supplies and which consumes.
  const isTypeLocked = isEdit && site.requestCount > 0;

  const [code, setCode] = useState(site?.code ?? "");
  const [name, setName] = useState(site?.name ?? "");
  const [type, setType] = useState<SiteType>(site?.type ?? "CONSUMING");

  const done = () => {
    router.refresh();
    onClose();
  };

  const create = useMutation(
    trpc.referential.sites.create.mutationOptions({
      onSuccess: () => {
        toast.success("Site cree");
        done();
      },
      onError: (cause) => {
        toast.error("Creation refusee", cause.message);
      },
    }),
  );

  const update = useMutation(
    trpc.referential.sites.update.mutationOptions({
      onSuccess: () => {
        toast.success("Site mis a jour");
        done();
      },
      onError: (cause) => {
        toast.error("Modification refusee", cause.message);
      },
    }),
  );

  const isPending = create.isPending || update.isPending;

  const submit = () => {
    if (name.trim().length < 2) {
      toast.error("Saisie incomplete", "Un nom de site est requis.");
      return;
    }

    if (isEdit) {
      update.mutate({ siteId: site.id, name, type });
      return;
    }

    create.mutate({ code, name, type });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? `Modifier ${site.code}` : "Nouveau site"}
      description={
        isEdit
          ? "Le code ne se modifie pas : il identifie le site sur tous les ecrans et sur les etiquettes."
          : "Un site consommateur demande, un site fournisseur prepare et expedie."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Enregistrement..." : isEdit ? "Enregistrer" : "Creer le site"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!isEdit && (
          <Field label="Code" required description="Mis en majuscules automatiquement, ex. LTN7.">
            {(props) => (
              <Input
                {...props}
                value={code}
                placeholder="LTN7"
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
            )}
          </Field>
        )}

        <Field label="Nom" required>
          {(props) => (
            <Input
              {...props}
              value={name}
              placeholder="LEONI Tunisie 7"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>

        <Field
          label="Type"
          {...(isTypeLocked
            ? {
                description: `Verrouille : ${String(site.requestCount)} demande(s) s appuient sur ce type pour determiner le sens du transfert.`,
              }
            : {})}
        >
          {(props) => (
            <Select
              {...props}
              value={type}
              disabled={isTypeLocked}
              onChange={(event) => {
                const next = SITE_TYPES.find((candidate) => candidate === event.target.value);
                setType(next ?? "CONSUMING");
              }}
            >
              {SITE_TYPES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {SITE_TYPE_LABELS_FR[candidate]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
