"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LocationItem, SiteItem } from "@leoni/contracts";
import { Button, Dialog, Field, Input, Select, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface LocationFormDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly sites: readonly SiteItem[];
  /** Omitted to create; supplied to edit. */
  readonly location?: LocationItem;
  readonly onSaved?: () => void;
}

export function LocationFormDialog({
  open,
  onClose,
  sites,
  location,
  onSaved,
}: LocationFormDialogProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const isEdit = location !== undefined;

  const [siteId, setSiteId] = useState(location?.siteId ?? sites[0]?.id ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [description, setDescription] = useState(location?.description ?? "");

  const done = () => {
    onSaved?.();
    router.refresh();
    onClose();
  };

  const create = useMutation(
    trpc.referential.locations.create.mutationOptions({
      onSuccess: () => {
        toast.success("Emplacement cree");
        done();
      },
      onError: (cause) => {
        toast.error("Creation refusee", cause.message);
      },
    }),
  );

  const update = useMutation(
    trpc.referential.locations.update.mutationOptions({
      onSuccess: () => {
        toast.success("Emplacement mis a jour");
        done();
      },
      onError: (cause) => {
        toast.error("Modification refusee", cause.message);
      },
    }),
  );

  const isPending = create.isPending || update.isPending;

  const submit = () => {
    if (code.trim() === "") {
      toast.error("Saisie incomplete", "Un code d emplacement est requis.");
      return;
    }

    if (isEdit) {
      update.mutate({
        storageLocationId: location.id,
        code,
        ...(description === "" ? {} : { description }),
      });
      return;
    }

    create.mutate({ siteId, code, ...(description === "" ? {} : { description }) });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? `Modifier ${location.code}` : "Nouvel emplacement"}
      description={
        isEdit
          ? "Un emplacement ne change pas de site : deplacez le stock plutot que l etagere."
          : "Le code est unique par site. Il apparait dans le formulaire de saisie des mouvements."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Enregistrement..." : isEdit ? "Enregistrer" : "Creer l emplacement"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!isEdit && (
          <Field label="Site" required>
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

        <Field label="Code" required description="Mis en majuscules automatiquement, ex. B-07.">
          {(props) => (
            <Input
              {...props}
              value={code}
              placeholder="B-07"
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Description">
          {(props) => (
            <Input
              {...props}
              value={description}
              placeholder="Rayon B, niveau 7"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
