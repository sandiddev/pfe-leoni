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
export {
  AlertDialog,
  type AlertDialogProps,
} from "./primitives/alert-dialog";
export { Avatar, type AvatarProps, initialsOf } from "./primitives/avatar";
export { Badge, type BadgeProps, badgeVariants } from "./primitives/badge";
export { Button, type ButtonProps, buttonVariants } from "./primitives/button";
export { Checkbox } from "./primitives/checkbox";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./primitives/card";
export { Dialog, type DialogProps } from "./primitives/dialog";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu";
export { Input, Label } from "./primitives/input";
export { Pagination, type PaginationProps } from "./primitives/pagination";
export { Select } from "./primitives/select";
export { Separator } from "./primitives/separator";
export { Skeleton } from "./primitives/skeleton";
export { Spinner, type SpinnerProps } from "./primitives/spinner";
export { Switch } from "./primitives/switch";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/tabs";
export { Textarea } from "./primitives/textarea";
export {
  type ToastOptions,
  type ToastTone,
  Toaster,
  useToast,
} from "./primitives/toast";
export { Tooltip, type TooltipProps, TooltipProvider } from "./primitives/tooltip";
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
export { Breadcrumbs, type BreadcrumbsProps, type Crumb } from "./patterns/breadcrumbs";
export { ConfirmButton, type ConfirmButtonProps } from "./patterns/confirm-button";
export { DataTableShell, type DataTableShellProps } from "./patterns/data-table-shell";
export { EmptyState, type EmptyStateProps } from "./patterns/empty-state";
export { Field, type FieldProps } from "./patterns/field";
export { PageHeader, type PageHeaderProps } from "./patterns/page-header";
export { RequestStatusBadge, type RequestStatusBadgeProps } from "./patterns/request-status-badge";
export {
  type SortDirection,
  SortableTableHead,
  type SortableTableHeadProps,
} from "./patterns/sortable-table-head";
export { StatCard, type StatCardProps } from "./patterns/stat-card";
export { StatusStepper, type StatusStepperProps } from "./patterns/status-stepper";
