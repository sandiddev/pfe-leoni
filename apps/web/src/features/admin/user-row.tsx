"use client";

import { useState } from "react";

import { ROLE_LABELS_FR, type SiteOption, type UserItem } from "@leoni/contracts";
import { isCrossSiteRole, isRole, type Role, ROLES } from "@leoni/core";
import { Badge, Button, ConfirmButton, Select, TableCell, TableRow } from "@leoni/ui";

export interface UserRowProps {
  readonly user: UserItem;
  readonly sites: readonly SiteOption[];
  readonly canEdit: boolean;
  readonly isSelf: boolean;
  readonly isSaving: boolean;
  readonly onSave: (values: {
    readonly role: Role;
    readonly siteId: string | null;
    readonly isActive: boolean;
  }) => void;
  readonly onResetPassword: () => void;
  readonly isResetting: boolean;
}

/**
 * One account, editable in place.
 *
 * A cross-site role hides the plant select rather than disabling it: the field
 * has no meaning for the Administrator or the Logistics Manager, and a greyed
 * box still invites the question of what it would have done.
 *
 * The row owns its draft so an abandoned edit does not leak into the next one.
 */
export function UserRow({
  user,
  sites,
  canEdit,
  isSelf,
  isSaving,
  onSave,
  onResetPassword,
  isResetting,
}: UserRowProps) {
  const [role, setRole] = useState<Role>(user.role);
  const [siteId, setSiteId] = useState<string | null>(user.siteId);
  const [isActive, setIsActive] = useState(user.isActive);

  const spansBothPlants = isCrossSiteRole(role);

  return (
    <TableRow className={user.isActive ? undefined : "opacity-60"}>
      <TableCell>
        <p className="font-medium">{user.name}</p>
        <p className="text-xs text-foreground-muted">{user.email}</p>
      </TableCell>

      <TableCell className="w-56">
        <Select
          aria-label={`Role de ${user.name}`}
          disabled={!canEdit || isSelf}
          value={role}
          onChange={(event) => {
            const next = event.target.value;
            setRole(isRole(next) ? next : user.role);
          }}
        >
          {ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {ROLE_LABELS_FR[candidate]}
            </option>
          ))}
        </Select>
      </TableCell>

      <TableCell className="w-40">
        {spansBothPlants ? (
          <Badge variant="outline">Les deux sites</Badge>
        ) : (
          <Select
            aria-label={`Site de ${user.name}`}
            disabled={!canEdit}
            value={siteId ?? ""}
            onChange={(event) => {
              setSiteId(event.target.value === "" ? null : event.target.value);
            }}
          >
            <option value="">Aucun site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code}
              </option>
            ))}
          </Select>
        )}
      </TableCell>

      <TableCell>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            disabled={!canEdit || isSelf}
            checked={isActive}
            onChange={(event) => {
              setIsActive(event.target.checked);
            }}
          />
          {isActive ? "Actif" : "Desactive"}
        </label>
      </TableCell>

      <TableCell>
        {canEdit && (
          <div className="flex justify-end gap-2">
            <ConfirmButton
              size="sm"
              variant="outline"
              isPending={isResetting}
              confirmTitle={`Reinitialiser le mot de passe de ${user.name} ?`}
              confirmDescription="Un nouveau mot de passe sera genere et affiche une seule fois. Toutes les sessions ouvertes de ce compte seront fermees immediatement."
              confirmLabel="Reinitialiser"
              onConfirm={onResetPassword}
            >
              Mot de passe
            </ConfirmButton>

            <Button
              size="sm"
              disabled={isSaving}
              title={isSelf ? "Vous ne pouvez pas modifier votre propre role" : undefined}
              onClick={() => {
                onSave({ role, siteId: spansBothPlants ? null : siteId, isActive });
              }}
            >
              Enregistrer
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
