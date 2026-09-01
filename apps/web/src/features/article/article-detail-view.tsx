"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { ABC_CLASS_LABELS_FR, type ArticleDetail } from "@leoni/contracts";
import {
  AlertLevelBadge,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  formatCoverage,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatQuantity,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@leoni/ui";
import { MovementTypeBadge } from "~/features/stock/movement-type-badge";

import { ArticleFormDialog } from "./article-form-dialog";
import { ArticleParameters } from "./article-parameters";
import { ThresholdChart } from "./threshold-chart";
import { ThresholdComparison } from "./threshold-comparison";

export interface ArticleDetailViewProps {
  readonly article: ArticleDetail;
  readonly canWrite: boolean;
}

export function ArticleDetailView({ article, canWrite }: ArticleDetailViewProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <AlertLevelBadge level={article.alertLevel} />
        <Badge variant="outline">{ABC_CLASS_LABELS_FR[article.abcClass]}</Badge>
        {!article.isActive && <Badge variant="stopped">Archive</Badge>}
        <span className="text-sm text-foreground-muted">
          Dernier recalcul : {formatDateTime(article.lastRecalculatedAt)}
        </span>

        {canWrite && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            <Pencil />
            Modifier
          </Button>
        )}
      </div>

      <Tabs defaultValue="synthese">
        <TabsList>
          <TabsTrigger value="synthese">Synthese</TabsTrigger>
          <TabsTrigger value="lots">Lots ({article.lots.length})</TabsTrigger>
          <TabsTrigger value="mouvements">Mouvements ({article.recentMovements.length})</TabsTrigger>
          <TabsTrigger value="seuils">Seuils</TabsTrigger>
        </TabsList>

        <TabsContent value="synthese">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Situation du stock</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {[
                    ["Stock actuel", formatQuantity(article.currentStock)],
                    ["Stock de securite", formatQuantity(article.safetyStock)],
                    ["Seuil mini", formatQuantity(article.minThreshold)],
                    ["Seuil maxi", formatQuantity(article.maxThreshold)],
                    [
                      "Consommation moyenne",
                      `${formatDecimal(article.averageDailyConsumption)} / jour`,
                    ],
                    ["Couverture", formatCoverage(article.coverageDays)],
                  ].map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-foreground-muted">{label}</dt>
                      <dd className="tabular text-right font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>

                {article.willRunOutBeforeResupply && (
                  <p className="mt-3 rounded-md bg-status-critical-subtle px-3 py-2 text-sm text-status-critical">
                    La couverture restante est inferieure au delai de livraison de LTN4 : une
                    rupture est probable avant l arrivee du reapprovisionnement.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Proposition de reapprovisionnement</CardTitle>
                <CardDescription>
                  Arrondie au multiple de VPE superieur (brief section 3.3).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {article.isReplenishmentNeeded ? (
                  <div className="space-y-3">
                    <p className="tabular text-3xl font-semibold text-primary">
                      {formatQuantity(article.recommendedQuantity)}
                    </p>
                    <p className="text-sm text-foreground-muted">
                      Besoin {formatQuantity(article.need)} unites, soit{" "}
                      {formatQuantity(article.boxCount)} boite(s) de {formatQuantity(article.vpe)}.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-foreground-muted">
                    Le stock est au-dessus du seuil de declenchement. Rien a commander.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Modele de l etude contre modele enrichi</CardTitle>
                <CardDescription>
                  Les deux jeux de seuils sur les memes donnees, pour que l enrichissement se
                  defende avec des chiffres.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ThresholdComparison article={article} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="lots">
          {article.lots.length === 0 ? (
            <EmptyState
              title="Aucun lot en stock"
              description="Cet article n a rien sur les etageres de ce site."
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emplacement</TableHead>
                    <TableHead>Date d entree (FIFO)</TableHead>
                    <TableHead>Lot fournisseur</TableHead>
                    <TableNumericHead>Quantite</TableNumericHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {article.lots.map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell className="font-medium">{lot.locationCode}</TableCell>
                      <TableCell className="text-foreground-muted">
                        {formatDate(lot.fifoDate)}
                      </TableCell>
                      {/* A dash, not an empty cell: stock counted before batch
                          capture existed has none, and saying so is honest. */}
                      <TableCell className="text-foreground-muted">
                        {lot.batchReference ?? "—"}
                        {lot.supplierReference !== null && (
                          <span className="ml-2 text-xs">({lot.supplierReference})</span>
                        )}
                      </TableCell>
                      <TableNumericCell>{formatQuantity(lot.quantity)}</TableNumericCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </TabsContent>

        <TabsContent value="mouvements">
          {article.recentMovements.length === 0 ? (
            <EmptyState
              title="Aucun mouvement"
              description="Le journal de cet article est vide sur ce site."
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableNumericHead>Quantite</TableNumericHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Saisi par</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {article.recentMovements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap text-foreground-muted">
                        {formatDateTime(movement.occurredAt)}
                      </TableCell>
                      <TableCell>
                        <MovementTypeBadge type={movement.type} />
                      </TableCell>
                      <TableNumericCell>{formatQuantity(movement.quantity)}</TableNumericCell>
                      <TableCell className="text-foreground-muted">
                        {movement.reference ?? "—"}
                      </TableCell>
                      <TableCell className="text-foreground-muted">
                        {movement.userName ?? "Systeme"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </TabsContent>

        <TabsContent value="seuils">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Parametres appliques</CardTitle>
                <CardDescription>
                  Par defaut ceux de la classe ABC. Un article critique peut recevoir les siens
                  sans deplacer toute sa classe (brief section 3.4).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ArticleParameters articleId={article.articleId} canWrite={canWrite} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evolution des seuils</CardTitle>
                <CardDescription>
                  Chaque point est un recalcul, avec les parametres en vigueur a ce moment-la
                  (brief section 3.5).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ThresholdChart points={article.thresholdHistory} />
              </CardContent>
            </Card>

            {article.thresholdHistory.length > 0 && (
              <TableContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableNumericHead>Conso./jour</TableNumericHead>
                      <TableNumericHead>Securite</TableNumericHead>
                      <TableNumericHead>Seuil mini</TableNumericHead>
                      <TableNumericHead>Seuil maxi</TableNumericHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {article.thresholdHistory.map((point) => (
                      <TableRow key={point.computedAt.toISOString()}>
                        <TableCell className="whitespace-nowrap text-foreground-muted">
                          {formatDateTime(point.computedAt)}
                        </TableCell>
                        <TableNumericCell>
                          {formatDecimal(point.averageDailyConsumption)}
                        </TableNumericCell>
                        <TableNumericCell className="text-foreground-muted">
                          {formatQuantity(point.safetyStock)}
                        </TableNumericCell>
                        <TableNumericCell>{formatQuantity(point.minThreshold)}</TableNumericCell>
                        <TableNumericCell>{formatQuantity(point.maxThreshold)}</TableNumericCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {isEditing && (
        <ArticleFormDialog
          open
          article={article}
          onClose={() => {
            setIsEditing(false);
          }}
        />
      )}
    </div>
  );
}
