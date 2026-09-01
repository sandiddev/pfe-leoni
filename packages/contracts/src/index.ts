/**
 * `@leoni/contracts` — the shared vocabulary between server and browser.
 *
 * Holds the Zod schemas that validate every tRPC input, the DTO types the
 * routers return, and the French labels the interface renders. It depends only
 * on `@leoni/core` (for the domain unions) and Zod, so both the API and the UI
 * can import it without either depending on the other.
 */

// --- Labels ----------------------------------------------------------------
export {
  ABC_CLASS_LABELS_FR,
  ALERT_LEVEL_LABELS_FR,
  GLOSSARY_FR,
  MOVEMENT_TYPE_LABELS_FR,
  NOTIFICATION_TYPE_LABELS_FR,
  PERMISSION_LABELS_FR,
  PRIORITY_LABELS_FR,
  RECALCULATION_TRIGGER_LABELS_FR,
  REQUEST_ACTION_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  ROLE_LABELS_FR,
  SITE_TYPE_LABELS_FR,
} from "./labels/fr";

// --- Common schemas ---------------------------------------------------------
export {
  type Page,
  type Pagination,
  abcClassSchema,
  alertLevelSchema,
  idSchema,
  paginationSchema,
  positiveQuantitySchema,
  quantitySchema,
  reasonSchema,
  requestStatusSchema,
  roleSchema,
  searchSchema,
  sortDirectionSchema,
} from "./schemas/common";

// --- Article ----------------------------------------------------------------
export {
  ARTICLE_IMPORT_COLUMNS,
  ARTICLE_IMPORT_HEADERS_FR,
  type ArticleByIdInput,
  type ArticleDetail,
  type ArticleImportColumn,
  type ArticleImportError,
  type ArticleImportResult,
  type ArticleImportRow,
  type CreateArticleInput,
  type ArticleListInput,
  type ArticleListItem,
  type LegacyThresholdComparison,
  type StockLotItem,
  type StockMovementItem,
  type ThresholdHistoryPoint,
  type UpdateArticleInput,
  articleByIdInputSchema,
  articleImportRowSchema,
  articleListInputSchema,
  articleSortFieldSchema,
  createArticleInputSchema,
  updateArticleInputSchema,
} from "./schemas/article";

// --- Stock ------------------------------------------------------------------
export {
  type AdjustStockInput,
  type RecordMovementInput,
  type RecordMovementResult,
  type StockByLocationInput,
  type StockByLocationItem,
  type StockMovementListInput,
  type StockMovementListItem,
  type StorageLocationOption,
  adjustStockInputSchema,
  movementTypeSchema,
  recordMovementInputSchema,
  stockByLocationInputSchema,
  stockMovementListInputSchema,
} from "./schemas/stock";

// --- Alert ------------------------------------------------------------------
export {
  type AlertBoardInput,
  type AlertBoardItem,
  type AlertSummary,
  type AlertSummaryInput,
  alertBoardInputSchema,
  alertSummaryInputSchema,
} from "./schemas/alert";

// --- Request ----------------------------------------------------------------
export {
  ALLOWED_ATTACHMENT_TYPES,
  type AttachmentItem,
  type AttachmentListInput,
  type AvailableAction,
  type CommentRequestInput,
  type CreateRequestInput,
  type RequestByIdInput,
  type RequestCommentItem,
  type RequestDetail,
  type RequestHistoryEntry,
  type RequestLineItem,
  type DeleteAttachmentInput,
  type DeleteDraftInput,
  MAX_ATTACHMENT_BYTES,
  type RecordAttachmentInput,
  type RequestListInput,
  type RequestListItem,
  type UpdateDraftInput,
  type TransitionRequestInput,
  type TransitionResult,
  type TransitionStockChange,
  attachmentListInputSchema,
  commentRequestInputSchema,
  createRequestInputSchema,
  createRequestLineSchema,
  deleteAttachmentInputSchema,
  deleteDraftInputSchema,
  recordAttachmentInputSchema,
  requestByIdInputSchema,
  requestListInputSchema,
  requestPrioritySchema,
  transitionActionSchema,
  transitionRequestInputSchema,
  updateDraftInputSchema,
} from "./schemas/request";

// --- Parameter --------------------------------------------------------------
export {
  type ArticleParameterInput,
  type ArticleParameters,
  type ParameterHistoryInput,
  type ParameterItem,
  type RecalculateInput,
  type RecalculationHistoryItem,
  type RecalculationResult,
  type UpdateParameterInput,
  type UpsertArticleParameterInput,
  articleParameterInputSchema,
  averagingWindowSchema,
  parameterHistoryInputSchema,
  recalculateInputSchema,
  updateParameterInputSchema,
  upsertArticleParameterInputSchema,
} from "./schemas/parameter";

// --- Notification -----------------------------------------------------------
export {
  type MarkNotificationReadInput,
  type NotificationItem,
  type NotificationListInput,
  markNotificationReadInputSchema,
  notificationListInputSchema,
  notificationTypeSchema,
} from "./schemas/notification";

// --- Dashboard --------------------------------------------------------------
export {
  type AlertDistribution,
  type DashboardExport,
  type DashboardExportInput,
  type DashboardInput,
  type DashboardSummary,
  type LeadTimeSummary,
  type ServiceLevel,
  type StatusCount,
  type StockOutPoint,
  dashboardExportInputSchema,
  dashboardInputSchema,
} from "./schemas/dashboard";

// --- Admin ------------------------------------------------------------------
export {
  type AuditChange,
  type AuditEntryItem,
  type AuditListInput,
  type CreateUserInput,
  type ProvisionedCredentials,
  type ResetPasswordInput,
  type SiteOption,
  type UpdateUserInput,
  type UserItem,
  type UserListInput,
  auditListInputSchema,
  createUserInputSchema,
  resetPasswordInputSchema,
  updateUserInputSchema,
  userListInputSchema,
} from "./schemas/admin";

// --- Referential ------------------------------------------------------------
export {
  type CreateLocationInput,
  type CreateSiteInput,
  type DeleteLocationInput,
  type LocationItem,
  type LocationListInput,
  type SiteItem,
  type UpdateLocationInput,
  type UpdateSiteInput,
  createLocationInputSchema,
  createSiteInputSchema,
  deleteLocationInputSchema,
  locationListInputSchema,
  siteTypeSchema,
  updateLocationInputSchema,
  updateSiteInputSchema,
} from "./schemas/referential";
