"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ARTICLE_IMPORT_COLUMNS,
  ARTICLE_IMPORT_HEADERS_FR,
  type ArticleImportResult,
} from "@leoni/contracts";
import { Button, Dialog, formatQuantity, Label, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

/**
 * Importing a catalogue from a CSV export (brief section 6.1).
 *
 * The file is read in the browser and its text sent to a tRPC mutation, rather
 * than posted as multipart to a route handler. A catalogue is a few hundred
 * kilobytes of text, and reading it here means the whole path — permission,
 * validation, per-line errors — is the same procedure a service test can call.
 *
 * Errors are shown per line, and nothing is imported when there are any: the
 * server validates the file whole. That is what this dialog has to communicate,
 * because a partial import is the outcome people fear and will assume.
 */
export function ArticleImportDialog() {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ArticleImportResult | null>(null);

  const close = () => {
    setOpen(false);
    setResult(null);
  };

  const importArticles = useMutation(
    trpc.article.import.mutationOptions({
      onSuccess: (outcome: ArticleImportResult) => {
        setResult(outcome);

        if (outcome.errors.length > 0) {
          toast.error(
            "Import refuse",
            `${formatQuantity(outcome.errors.length)} erreur(s) : aucun article n a ete modifie.`,
          );
          return;
        }

        toast.success(
          "Import termine",
          `${formatQuantity(outcome.imported)} cree(s), ${formatQuantity(outcome.updated)} mis a jour.`,
        );
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Import refuse", cause.message);
      },
    }),
  );

  const onFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setResult(null);
    importArticles.mutate({ content: await file.text() });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Importer un CSV
      </Button>

      {open && (
        <Dialog
          open
          onClose={close}
          title="Importer un catalogue"
          description="Le fichier est verifie en entier avant tout enregistrement : en cas d erreur, aucun article n est modifie."
          footer={
            <Button variant="outline" onClick={close}>
              Fermer
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="import-file">Fichier CSV</Label>
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                disabled={importArticles.isPending}
                className="block w-full text-sm text-foreground-muted"
                onChange={(event) => {
                  void onFile(event.target.files?.[0]);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Colonnes attendues</p>
              <p className="text-xs text-foreground-muted">
                {ARTICLE_IMPORT_COLUMNS.map(
                  (column) => `${column} (${ARTICLE_IMPORT_HEADERS_FR[column]})`,
                ).join(" · ")}
              </p>
              <a
                href="/api/articles/modele-import"
                className="text-xs text-accent underline underline-offset-2"
              >
                Telecharger un fichier modele
              </a>
            </div>

            {importArticles.isPending && (
              <p className="text-sm text-foreground-muted">Verification du fichier...</p>
            )}

            {result !== null && result.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-status-critical">
                  {formatQuantity(result.errors.length)} erreur(s) sur{" "}
                  {formatQuantity(result.rows)} ligne(s) — aucun article modifie
                </p>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                  {result.errors.map((error, index) => (
                    <li key={`${String(error.line)}-${error.column ?? ""}-${String(index)}`}>
                      <span className="tabular font-medium">Ligne {error.line}</span>
                      {error.column === null ? "" : ` · ${error.column}`} — {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result !== null && result.errors.length === 0 && (
              <p className="text-sm text-status-normal">
                {formatQuantity(result.imported)} article(s) cree(s),{" "}
                {formatQuantity(result.updated)} mis a jour. Les seuils ont ete recalcules.
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
