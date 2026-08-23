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
  PERMISSION_LABELS_FR,
  PRIORITY_LABELS_FR,
  RECALCULATION_TRIGGER_LABELS_FR,
  REQUEST_ACTION_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  ROLE_LABELS_FR,
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
  type ArticleByIdInput,
  type ArticleDetail,
  type ArticleListInput,
  type ArticleListItem,
  type StockLotItem,
  type StockMovementItem,
  type ThresholdHistoryPoint,
  type UpdateArticleInput,
  articleByIdInputSchema,
  articleListInputSchema,
  articleSortFieldSchema,
  updateArticleInputSchema,
} from "./schemas/article";
