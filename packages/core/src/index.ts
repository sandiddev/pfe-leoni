/**
 * `@leoni/core` — the domain layer.
 *
 * Contains the replenishment formulas (brief section 3), the request workflow
 * (section 5) and the authorisation model (section 4). It depends on nothing:
 * no framework, no database, no workspace package. That constraint is enforced
 * by lint, and it is what allows every rule below to be unit-tested in
 * milliseconds and read by someone who knows logistics but not TypeScript
 * tooling.
 *
 * Exports are explicit rather than `export *` so this file doubles as the
 * package's documented public surface.
 */

// --- Shared ----------------------------------------------------------------
export { assertNever } from "./shared/assert-never";
export {
  type ArticleId,
  type Brand,
  type ReplenishmentRequestId,
  type SiteId,
  type StockItemId,
  type UserId,
  toBrandedId,
} from "./shared/brand";
export { clamp, roundThreshold, roundTo } from "./shared/rounding";
export {
  MOVEMENT_TYPES,
  type MovementType,
  NOTIFICATION_TYPES,
  type NotificationType,
  RECALCULATION_TRIGGERS,
  type RecalculationTrigger,
  REQUEST_PRIORITIES,
  type RequestPriority,
  SITE_TYPES,
  type SiteType,
} from "./shared/enums";

// --- Errors ----------------------------------------------------------------
export {
  BusinessRuleError,
  ConflictError,
  DomainError,
  ForbiddenActionError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
  isDomainError,
} from "./errors/domain-error";

// --- Access ----------------------------------------------------------------
export { type Permission, PERMISSIONS, isPermission } from "./access/permission";
export {
  ROLE_PERMISSIONS,
  assertCan,
  can,
  canAccessSite,
  canAll,
  canAny,
} from "./access/permissions";
export { CROSS_SITE_ROLES, type Role, ROLES, isCrossSiteRole, isRole } from "./access/role";

// --- Stock -----------------------------------------------------------------
export {
  type FifoAllocation,
  type FifoLot,
  allocateFifo,
  totalAvailable,
} from "./stock/fifo";
export {
  type ApplyMovementInputs,
  applyMovement,
  isConsumption,
  wouldGoNegative,
} from "./stock/movement";

// --- Replenishment ---------------------------------------------------------
export {
  ABC_CLASSES,
  type AbcClass,
  type AbcClassification,
  type ClassifiableArticle,
  DEFAULT_PARETO,
  type ParetoThresholds,
  classifyAbc,
  isAbcClass,
} from "./replenishment/abc-class";
export {
  ALERT_LEVELS,
  ALERT_LEVEL_SEVERITY,
  type AlertLevel,
  type AlertLevelInputs,
  DEFAULT_WARNING_MARGIN_RATIO,
  compareAlertSeverityDesc,
  isAtLeastAsSevere,
  resolveAlertLevel,
} from "./replenishment/alert-level";
export {
  type ClassParameters,
  DEFAULT_CLASS_PARAMETERS,
  defaultParametersForClass,
} from "./replenishment/class-parameters";
export {
  AVERAGING_WINDOWS,
  type AveragingWindowDays,
  type ConsumptionSample,
  DEFAULT_AVERAGING_WINDOW_DAYS,
  type RollingAverageInput,
  rollingAverageDailyConsumption,
} from "./replenishment/consumption";
export { daysOfCoverage, isCoverageBelowLeadTime } from "./replenishment/coverage";
export {
  type LegacyThresholdInputs,
  type LegacyThresholds,
  computeLegacyThresholds,
} from "./replenishment/legacy-thresholds";
export {
  type OrderQuantity,
  type OrderQuantityInputs,
  computeBoxCount,
  computeNeed,
  computeOrderQuantity,
} from "./replenishment/order-quantity";
export {
  type StockAssessment,
  type StockAssessmentInputs,
  assessStockItem,
} from "./replenishment/stock-assessment";
export {
  type ThresholdInputs,
  type Thresholds,
  computeMax,
  computeMin,
  computeSafetyStock,
  computeThresholds,
} from "./replenishment/thresholds";

// --- Workflow --------------------------------------------------------------
export {
  type TransitionAttempt,
  assertTransition,
  availableTransitions,
  canTransition,
  findTransition,
  transitionsFrom,
} from "./workflow/can-transition";
export { type Lateness, type LatenessInputs, assessLateness } from "./workflow/lateness";
export {
  EXCEPTION_STATUSES,
  NOMINAL_STATUS_SEQUENCE,
  REQUEST_STATUSES,
  type RequestStatus,
  TERMINAL_STATUSES,
  type TerminalStatus,
  isExceptionStatus,
  isRequestStatus,
  isTerminalStatus,
  nominalStepIndex,
} from "./workflow/request-status";
export {
  ACTION_PERMISSIONS,
  TRANSITION_ACTIONS,
  TRANSITIONS,
  type TransitionAction,
  type TransitionDefinition,
} from "./workflow/transitions";
