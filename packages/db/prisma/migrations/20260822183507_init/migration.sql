-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'LTN1_STOREKEEPER', 'LTN1_WAREHOUSE_MANAGER', 'LTN4_RESPONSIBLE', 'LOGISTICS_MANAGER');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('CONSUMING', 'SUPPLYING');

-- CreateEnum
CREATE TYPE "AbcClass" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_LTN4', 'IN_PREPARATION', 'PARTIALLY_AVAILABLE', 'LTN4_STOCK_OUT', 'READY', 'SHIPPED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('NORMAL', 'WARNING', 'CRITICAL', 'RUPTURE');

-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RecalculationTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'IMPORT', 'PARAMETER_CHANGE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('STOCK_CRITICAL', 'STOCK_RUPTURE', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_SHIPPED', 'REQUEST_RECEIVED', 'REQUEST_LATE', 'LTN4_STOCK_OUT');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'LTN1_STOREKEEPER',
    "siteId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alert_snapshot" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "minThreshold" DECIMAL(12,3) NOT NULL,
    "coverageDays" DECIMAL(8,1),
    "snapshotDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_alert_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SiteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "vpe" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 2,
    "abcClass" "AbcClass" NOT NULL DEFAULT 'C',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenishment_parameter" (
    "id" TEXT NOT NULL,
    "abcClass" "AbcClass",
    "articleId" TEXT,
    "safetyDays" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "extraCoverageDays" DECIMAL(6,2) NOT NULL DEFAULT 5,
    "averagingWindowDays" INTEGER NOT NULL DEFAULT 30,
    "warningMarginRatio" DECIMAL(4,3) NOT NULL DEFAULT 0.2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replenishment_parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_history" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "averageDailyConsumption" DECIMAL(12,3) NOT NULL,
    "minThreshold" DECIMAL(12,3) NOT NULL,
    "maxThreshold" DECIMAL(12,3) NOT NULL,
    "safetyStock" DECIMAL(12,3) NOT NULL,
    "parametersSnapshot" JSONB NOT NULL,
    "trigger" "RecalculationTrigger" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedById" TEXT,

    CONSTRAINT "threshold_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenishment_request" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "fromSiteId" TEXT NOT NULL,
    "toSiteId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "expectedDeliveryAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replenishment_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenishment_request_line" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "approvedQuantity" INTEGER,
    "preparedQuantity" INTEGER,
    "shippedQuantity" INTEGER,
    "receivedQuantity" INTEGER,
    "vpeSnapshot" INTEGER NOT NULL,
    "suggestedQuantity" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replenishment_request_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_history" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "userId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_comment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_attachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_item" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "averageDailyConsumption" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minThreshold" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "maxThreshold" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "safetyStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "lastRecalculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lot" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fifoDate" TIMESTAMP(3) NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "storageLocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "note" TEXT,
    "stockItemId" TEXT NOT NULL,
    "lotId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_siteId_idx" ON "user"("siteId");

-- CreateIndex
CREATE INDEX "user_role_idx" ON "user"("role");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notification_createdAt_idx" ON "notification"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_occurredAt_idx" ON "audit_log"("occurredAt");

-- CreateIndex
CREATE INDEX "stock_alert_snapshot_snapshotDate_level_idx" ON "stock_alert_snapshot"("snapshotDate", "level");

-- CreateIndex
CREATE UNIQUE INDEX "stock_alert_snapshot_stockItemId_snapshotDate_key" ON "stock_alert_snapshot"("stockItemId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "site_code_key" ON "site"("code");

-- CreateIndex
CREATE INDEX "storage_location_siteId_idx" ON "storage_location"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_location_siteId_code_key" ON "storage_location"("siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "article_reference_key" ON "article"("reference");

-- CreateIndex
CREATE INDEX "article_abcClass_idx" ON "article"("abcClass");

-- CreateIndex
CREATE INDEX "article_isActive_idx" ON "article"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "replenishment_parameter_abcClass_key" ON "replenishment_parameter"("abcClass");

-- CreateIndex
CREATE UNIQUE INDEX "replenishment_parameter_articleId_key" ON "replenishment_parameter"("articleId");

-- CreateIndex
CREATE INDEX "threshold_history_stockItemId_computedAt_idx" ON "threshold_history"("stockItemId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "replenishment_request_code_key" ON "replenishment_request"("code");

-- CreateIndex
CREATE INDEX "replenishment_request_status_idx" ON "replenishment_request"("status");

-- CreateIndex
CREATE INDEX "replenishment_request_toSiteId_status_idx" ON "replenishment_request"("toSiteId", "status");

-- CreateIndex
CREATE INDEX "replenishment_request_fromSiteId_status_idx" ON "replenishment_request"("fromSiteId", "status");

-- CreateIndex
CREATE INDEX "replenishment_request_createdAt_idx" ON "replenishment_request"("createdAt");

-- CreateIndex
CREATE INDEX "replenishment_request_line_articleId_idx" ON "replenishment_request_line"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "replenishment_request_line_requestId_articleId_key" ON "replenishment_request_line"("requestId", "articleId");

-- CreateIndex
CREATE INDEX "request_status_history_requestId_occurredAt_idx" ON "request_status_history"("requestId", "occurredAt");

-- CreateIndex
CREATE INDEX "request_comment_requestId_createdAt_idx" ON "request_comment"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "request_attachment_requestId_idx" ON "request_attachment"("requestId");

-- CreateIndex
CREATE INDEX "stock_item_siteId_idx" ON "stock_item"("siteId");

-- CreateIndex
CREATE INDEX "stock_item_articleId_idx" ON "stock_item"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_item_articleId_siteId_key" ON "stock_item"("articleId", "siteId");

-- CreateIndex
CREATE INDEX "stock_lot_stockItemId_fifoDate_idx" ON "stock_lot"("stockItemId", "fifoDate");

-- CreateIndex
CREATE INDEX "stock_lot_storageLocationId_idx" ON "stock_lot"("storageLocationId");

-- CreateIndex
CREATE INDEX "stock_movement_stockItemId_occurredAt_idx" ON "stock_movement"("stockItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movement_type_idx" ON "stock_movement"("type");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alert_snapshot" ADD CONSTRAINT "stock_alert_snapshot_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_location" ADD CONSTRAINT "storage_location_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_parameter" ADD CONSTRAINT "replenishment_parameter_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_history" ADD CONSTRAINT "threshold_history_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request" ADD CONSTRAINT "replenishment_request_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request" ADD CONSTRAINT "replenishment_request_toSiteId_fkey" FOREIGN KEY ("toSiteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request" ADD CONSTRAINT "replenishment_request_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request" ADD CONSTRAINT "replenishment_request_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request_line" ADD CONSTRAINT "replenishment_request_line_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "replenishment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request_line" ADD CONSTRAINT "replenishment_request_line_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "replenishment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comment" ADD CONSTRAINT "request_comment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "replenishment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comment" ADD CONSTRAINT "request_comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "replenishment_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
