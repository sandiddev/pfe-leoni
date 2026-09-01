"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@leoni/ui";
import { useTRPCClient } from "~/trpc/client";

export interface ExportButtonProps {
  readonly days: number;
}

/**
 * Downloads the KPI series as a CSV.
 *
 * The file is generated on the server so the export cannot disagree with the
 * charts above it; the browser only turns the returned string into a download.
 * A BOM is prepended because Excel on a French Windows machine otherwise reads
 * a UTF-8 CSV as Latin-1 and renders every accent as mojibake.
 */
export function ExportButton({ days }: ExportButtonProps) {
  const client = useTRPCClient();
  const [isExporting, setIsExporting] = useState(false);

  async function download(): Promise<void> {
    setIsExporting(true);
    try {
      const result = await client.dashboard.export.query({ days });
      const blob = new Blob([`\uFEFF${result.content}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Button
      variant="outline"
      disabled={isExporting}
      onClick={() => {
        void download();
      }}
    >
      <Download />
      {isExporting ? "Export en cours..." : "Exporter (CSV)"}
    </Button>
  );
}
