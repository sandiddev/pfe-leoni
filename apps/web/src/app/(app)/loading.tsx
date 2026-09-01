import { Skeleton } from "@leoni/ui";

/**
 * The default skeleton for any section that has not declared its own.
 *
 * Shaped like a page header over a table, because that is what nine of the ten
 * screens are. A spinner in the middle of an empty page tells the user nothing
 * about what is arriving.
 */
export default function SectionLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-24 w-full" />
        ))}
      </div>

      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>

      <span className="sr-only">Chargement de la page</span>
    </div>
  );
}
