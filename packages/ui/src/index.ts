/**
 * `@leoni/ui` — the design system.
 *
 * Three layers, in increasing order of how much they know:
 *
 *   lib/        cn() and the French formatters
 *   primitives/ Button, Badge, Card, Input, Table — no domain knowledge
 *   patterns/   AlertLevelBadge, RequestStatusBadge, StatCard — these DO know
 *               the domain vocabulary, and that is exactly their purpose: they
 *               are the single place a stock level or a request status is
 *               turned into something a user reads.
 *
 * The package never imports @leoni/api, @leoni/db or @leoni/auth. A component
 * receives data as props; it does not go and fetch it. That is what lets any of
 * these be rendered in isolation, in a test or in the report screenshots.
 */

// --- Utilities --------------------------------------------------------------
export { cn } from "./lib/cn";
export {
  formatCoverage,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatQuantity,
} from "./lib/format";

// --- Primitives -------------------------------------------------------------
export { Badge, type BadgeProps, badgeVariants } from "./primitives/badge";
export { Button, type ButtonProps, buttonVariants } from "./primitives/button";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./primitives/card";
export { Input, Label } from "./primitives/input";
export { Skeleton } from "./primitives/skeleton";
export {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
} from "./primitives/table";

// --- Patterns ---------------------------------------------------------------
export { AlertLevelBadge, type AlertLevelBadgeProps } from "./patterns/alert-level-badge";
export { EmptyState, type EmptyStateProps } from "./patterns/empty-state";
export { PageHeader, type PageHeaderProps } from "./patterns/page-header";
export { RequestStatusBadge, type RequestStatusBadgeProps } from "./patterns/request-status-badge";
export { StatCard, type StatCardProps } from "./patterns/stat-card";
