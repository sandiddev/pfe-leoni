-- Index every foreign key.
--
-- Postgres does not create an index for a foreign key constraint. Each column
-- below is joined on, filtered by, or checked when its parent row is touched,
-- and without an index that is a sequential scan and a longer lock.
--
-- Enforced from here on by packages/db/src/schema-conventions.test.ts.

-- CreateIndex
CREATE INDEX "audit_log_actorId_idx" ON "audit_log"("actorId");

-- CreateIndex
CREATE INDEX "replenishment_request_createdById_idx" ON "replenishment_request"("createdById");

-- CreateIndex
CREATE INDEX "replenishment_request_approvedById_idx" ON "replenishment_request"("approvedById");

-- CreateIndex
CREATE INDEX "request_attachment_uploadedById_idx" ON "request_attachment"("uploadedById");

-- CreateIndex
CREATE INDEX "request_comment_userId_idx" ON "request_comment"("userId");

-- CreateIndex
CREATE INDEX "request_status_history_userId_idx" ON "request_status_history"("userId");

-- CreateIndex
CREATE INDEX "stock_movement_lotId_idx" ON "stock_movement"("lotId");

-- CreateIndex
CREATE INDEX "stock_movement_userId_idx" ON "stock_movement"("userId");

