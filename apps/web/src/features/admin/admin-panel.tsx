"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AuditEntryItem,
  LocationItem,
  ProvisionedCredentials,
  SiteItem,
  SiteOption,
  UserItem,
} from "@leoni/contracts";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { AuditLog } from "./audit-log";
import { PasswordDialog } from "./password-dialog";
import { ReferentialPanel } from "./referential-panel";
import { UserFormDialog } from "./user-form-dialog";
import { UserRow } from "./user-row";

export interface AdminPanelProps {
  readonly users: readonly UserItem[];
  /** Plants as a plain option list, for the user form's site select. */
  readonly sites: readonly SiteOption[];
  /** The same plants with their counts, for the referential tab. */
  readonly referentialSites: readonly SiteItem[];
  readonly locations: readonly LocationItem[];
  readonly initialAudit: readonly AuditEntryItem[];
  readonly auditTotalCount: number;
  readonly currentUserId: string;
  readonly canEditUsers: boolean;
  readonly canEditLocations: boolean;
  readonly canReadAudit: boolean;
}

export function AdminPanel({
  users,
  sites,
  referentialSites,
  locations,
  initialAudit,
  auditTotalCount,
  currentUserId,
  canEditUsers,
  canEditLocations,
  canReadAudit,
}: AdminPanelProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [isCreating, setIsCreating] = useState(false);
  const [issued, setIssued] = useState<ProvisionedCredentials | null>(null);

  const resetPassword = useMutation(
    trpc.admin.users.resetPassword.mutationOptions({
      // Shown rather than toasted: this is the only time the password exists in
      // readable form, and a toast that auto-dismisses would take it away.
      onSuccess: setIssued,
      onError: (cause) => {
        toast.error("Reinitialisation refusee", cause.message);
      },
    }),
  );

  const update = useMutation(
    trpc.admin.users.update.mutationOptions({
      onSuccess: () => {
        toast.success(
          "Compte mis a jour",
          "Le changement prend effet a la prochaine navigation de l utilisateur.",
        );
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Modification refusee", cause.message);
      },
    }),
  );

  return (
    <Tabs defaultValue="utilisateurs">
      <TabsList>
        <TabsTrigger value="utilisateurs">Utilisateurs ({users.length})</TabsTrigger>
        <TabsTrigger value="referentiel">Sites et emplacements</TabsTrigger>
        {canReadAudit && <TabsTrigger value="journal">Journal</TabsTrigger>}
      </TabsList>

      <TabsContent value="utilisateurs">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Comptes et roles</CardTitle>
            <CardDescription>
              Le role et le site decident de ce qu une personne peut faire sur le stock des deux
              usines. Un compte se desactive pour conserver un auteur resolvable dans l historique.
            </CardDescription>
          </div>
          {canEditUsers && (
            <Button
              onClick={() => {
                setIsCreating(true);
              }}
            >
              <Plus />
              Nouvel utilisateur
            </Button>
          )}
        </CardHeader>

        <CardContent>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Acces</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    sites={sites}
                    canEdit={canEditUsers}
                    isSelf={user.id === currentUserId}
                    isSaving={update.isPending}
                    isResetting={resetPassword.isPending}
                    onSave={(values) => {
                      update.mutate({ userId: user.id, ...values });
                    }}
                    onResetPassword={() => {
                      resetPassword.mutate({ userId: user.id });
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      </TabsContent>

      <TabsContent value="referentiel">
        <ReferentialPanel
          sites={referentialSites}
          locations={locations}
          canEditSites={canEditUsers}
          canEditLocations={canEditLocations}
        />
      </TabsContent>

      {canReadAudit && (
        <TabsContent value="journal">
          <Card>
            <CardHeader>
              <CardTitle>Journal des modifications</CardTitle>
              <CardDescription>
                Les changements de donnees de reference, de parametres et de comptes. Le workflow
                des demandes a sa propre trace, sur chaque demande.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AuditLog initialItems={initialAudit} totalCount={auditTotalCount} />
            </CardContent>
          </Card>
        </TabsContent>
      )}

      {isCreating && (
        <UserFormDialog
          open
          sites={sites}
          onClose={() => {
            setIsCreating(false);
          }}
        />
      )}

      {issued !== null && (
        <PasswordDialog
          open
          credentials={issued}
          onClose={() => {
            setIssued(null);
          }}
        />
      )}
    </Tabs>
  );
}
