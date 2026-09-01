"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type LocationItem, SITE_TYPE_LABELS_FR, type SiteItem } from "@leoni/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmButton,
  EmptyState,
  formatQuantity,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
  Tooltip,
  useToast,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { LocationFormDialog } from "./location-form-dialog";
import { SiteFormDialog } from "./site-form-dialog";

export interface ReferentialPanelProps {
  readonly sites: readonly SiteItem[];
  readonly locations: readonly LocationItem[];
  readonly canEditSites: boolean;
  readonly canEditLocations: boolean;
}

/**
 * Plants and the shelves inside them.
 *
 * The shelf table shows what each one is holding, which is what lets the delete
 * button explain itself before it is pressed: a shelf with lots on it has the
 * action disabled and a tooltip saying why, rather than a refusal on click.
 */
export function ReferentialPanel({
  sites,
  locations,
  canEditSites,
  canEditLocations,
}: ReferentialPanelProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [siteFilter, setSiteFilter] = useState("");
  const [editingSite, setEditingSite] = useState<SiteItem | null>(null);
  const [isCreatingSite, setIsCreatingSite] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationItem | null>(null);
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);

  const locationQuery = useQuery(
    trpc.referential.locations.list.queryOptions(
      siteFilter === "" ? {} : { siteId: siteFilter },
    ),
  );

  const shown = locationQuery.data ?? (siteFilter === "" ? locations : []);

  const remove = useMutation(
    trpc.referential.locations.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Emplacement supprime");
        void locationQuery.refetch();
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Suppression refusee", cause.message);
      },
    }),
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Sites</CardTitle>
            <CardDescription>
              Le type decide du sens des transferts : le site fournisseur prepare, le site
              consommateur demande. Il se verrouille des qu une demande s appuie dessus.
            </CardDescription>
          </div>
          {canEditSites && (
            <Button
              onClick={() => {
                setIsCreatingSite(true);
              }}
            >
              <Plus />
              Nouveau site
            </Button>
          )}
        </CardHeader>

        <CardContent>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Type</TableHead>
                  <TableNumericHead>Emplacements</TableNumericHead>
                  <TableNumericHead>Demandes</TableNumericHead>
                  {canEditSites && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>

              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.code}</TableCell>
                    <TableCell>{site.name}</TableCell>
                    <TableCell>
                      <Badge variant={site.type === "SUPPLYING" ? "primary" : "outline"}>
                        {SITE_TYPE_LABELS_FR[site.type]}
                      </Badge>
                    </TableCell>
                    <TableNumericCell>{formatQuantity(site.locationCount)}</TableNumericCell>
                    <TableNumericCell>{formatQuantity(site.requestCount)}</TableNumericCell>
                    {canEditSites && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Modifier ${site.code}`}
                          onClick={() => {
                            setEditingSite(site);
                          }}
                        >
                          <Pencil />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Emplacements de stockage</CardTitle>
            <CardDescription>
              Les etageres ou les lots se posent. Un emplacement occupe ne peut pas etre supprime :
              le stock doit d abord etre transfere.
            </CardDescription>
          </div>
          {canEditLocations && (
            <Button
              onClick={() => {
                setIsCreatingLocation(true);
              }}
            >
              <Plus />
              Nouvel emplacement
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <Select
            className="w-56"
            aria-label="Filtrer par site"
            value={siteFilter}
            onChange={(event) => {
              setSiteFilter(event.target.value);
            }}
          >
            <option value="">Tous les sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code}
              </option>
            ))}
          </Select>

          {shown.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="Aucun emplacement"
              description="Creez une premiere etagere pour pouvoir y enregistrer des entrees en stock."
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Site</TableHead>
                    <TableNumericHead>Lots</TableNumericHead>
                    <TableNumericHead>Quantite</TableNumericHead>
                    {canEditLocations && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {shown.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell className="font-medium">{location.code}</TableCell>
                      <TableCell className="text-foreground-muted">
                        {location.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-foreground-muted">{location.siteCode}</TableCell>
                      <TableNumericCell>{formatQuantity(location.lotCount)}</TableNumericCell>
                      <TableNumericCell>{formatQuantity(location.totalQuantity)}</TableNumericCell>

                      {canEditLocations && (
                        <TableCell className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Modifier ${location.code}`}
                            onClick={() => {
                              setEditingLocation(location);
                            }}
                          >
                            <Pencil />
                          </Button>

                          {location.lotCount > 0 ? (
                            <Tooltip
                              content={`Occupe : ${formatQuantity(location.totalQuantity)} unites sur ${formatQuantity(location.lotCount)} lot(s).`}
                            >
                              <span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled
                                  aria-label={`Suppression impossible pour ${location.code}`}
                                >
                                  <Trash2 />
                                </Button>
                              </span>
                            </Tooltip>
                          ) : (
                            <ConfirmButton
                              variant="ghost"
                              size="icon"
                              aria-label={`Supprimer ${location.code}`}
                              confirmTitle={`Supprimer l emplacement ${location.code} ?`}
                              confirmDescription="L emplacement disparaitra du formulaire de saisie. L operation est tracee dans le journal des modifications."
                              confirmLabel="Supprimer"
                              isPending={remove.isPending}
                              onConfirm={() => {
                                remove.mutate({ storageLocationId: location.id });
                              }}
                            >
                              <Trash2 />
                            </ConfirmButton>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {(isCreatingSite || editingSite !== null) && (
        <SiteFormDialog
          open
          {...(editingSite === null ? {} : { site: editingSite })}
          onClose={() => {
            setIsCreatingSite(false);
            setEditingSite(null);
          }}
        />
      )}

      {(isCreatingLocation || editingLocation !== null) && (
        <LocationFormDialog
          open
          sites={sites}
          {...(editingLocation === null ? {} : { location: editingLocation })}
          onClose={() => {
            setIsCreatingLocation(false);
            setEditingLocation(null);
          }}
          onSaved={() => {
            void locationQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
