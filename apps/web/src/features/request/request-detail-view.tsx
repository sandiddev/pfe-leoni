import { PRIORITY_LABELS_FR, type RequestDetail } from "@leoni/contracts";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  formatDate,
  formatDateTime,
  RequestStatusBadge,
  StatusStepper,
} from "@leoni/ui";

import { DraftEditor } from "./draft-editor";
import { RequestActionBar } from "./request-action-bar";
import { RequestAttachments } from "./request-attachments";
import { RequestComments } from "./request-comments";
import { RequestLines } from "./request-lines";
import { RequestTimeline } from "./request-timeline";

export interface RequestDetailViewProps {
  readonly request: RequestDetail;
  readonly canComment: boolean;
}

/** The milestones, so real lead time can be read against the committed one. */
function milestones(request: RequestDetail): readonly { label: string; at: Date | null }[] {
  return [
    { label: "Soumise", at: request.submittedAt },
    { label: "Validee", at: request.approvedAt },
    { label: "Transmise", at: request.sentAt },
    { label: "Preparee", at: request.preparedAt },
    { label: "Expediee", at: request.shippedAt },
    { label: "Receptionnee", at: request.receivedAt },
    { label: "Cloturee", at: request.closedAt },
  ];
}

export function RequestDetailView({ request, canComment }: RequestDetailViewProps) {
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            <Badge variant="outline">{PRIORITY_LABELS_FR[request.priority]}</Badge>
            {request.isLate && (
              <Badge variant="stopped">
                En retard de {String(request.daysLate)} jour(s)
              </Badge>
            )}
            <span className="text-sm text-foreground-muted">
              Livraison prevue : {formatDate(request.expectedDeliveryAt)}
            </span>
          </div>

          <StatusStepper status={request.status} />

          {request.reason !== null && (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-foreground-muted">
              <span className="font-medium text-foreground">Motif : </span>
              {request.reason}
            </p>
          )}

          <RequestActionBar
            requestId={request.id}
            actions={request.availableActions}
            lines={request.lines}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {request.status === "DRAFT" ? "Lignes du brouillon" : "Lignes de la demande"}
          </CardTitle>
          {request.status === "DRAFT" && (
            <CardDescription>
              Le brouillon est encore modifiable. Une fois soumis, seules les actions du workflow
              peuvent le faire evoluer.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {/* Editable only in DRAFT. Past that the five quantity columns are
              written by the workflow, not typed. */}
          {request.status === "DRAFT" ? (
            <DraftEditor request={request} />
          ) : (
            <RequestLines lines={request.lines} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Historique</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RequestTimeline history={request.history} />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
              {milestones(request).map((milestone) => (
                <div key={milestone.label} className="contents">
                  <dt className="text-foreground-muted">{milestone.label}</dt>
                  <dd className="tabular text-right">{formatDateTime(milestone.at)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Pieces jointes</CardTitle>
              <CardDescription>
                Bons de livraison, feuilles de preparation, photos d emballage endommage.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RequestAttachments requestId={request.id} canAttach={canComment} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Echanges</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestComments
                requestId={request.id}
                comments={request.comments}
                canComment={canComment}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
