import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LossReport as LossReportData } from "@/lib/convert/types";
import { kindForCount } from "@/lib/losses";
import { cn } from "@/lib/utils";

const formatCount = (count: number) => count.toLocaleString("en-US");

// One thin row in the output pane: "⚠ lossy: 12 nested objects …". Tap it to list the example paths and rules.
// A report with only rules (for example "comments not kept") shows as a quieter note.
export function LossReport({ losses }: { losses: LossReportData | null }) {
  const [open, setOpen] = useState(false);
  if (!losses || (losses.items.length === 0 && losses.rules.length === 0)) return null;

  const lossy = losses.items.length > 0;
  const summary = lossy
    ? losses.items.map((item) => `${formatCount(item.count)} ${kindForCount(item.kind, item.count)}`).join(", ")
    : losses.rules.join("; ");

  return (
    <div className="border-t text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={summary}
        className="flex w-full min-w-0 items-center gap-2 px-3.5 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className={cn("shrink-0", lossy ? "text-primary" : "text-dim")}>{lossy ? "⚠ lossy:" : "note:"}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
        <ChevronDown
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0 text-dim transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="max-h-40 space-y-1.5 overflow-y-auto px-3.5 pb-2 text-muted-foreground">
          {lossy && (
            <ul className="space-y-1">
              {losses.items.map((item) => (
                <li key={item.kind}>
                  <span className="text-foreground">{formatCount(item.count)}</span> {kindForCount(item.kind, item.count)}
                  {item.examples.length > 0 && (
                    <div className="break-all font-mono text-dim">
                      {item.examples.map((path) => path || "(root)").join(", ")}
                      {item.count > item.examples.length && ", …"}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {losses.rules.length > 0 && (
            <ul className="text-dim">
              {losses.rules.map((rule) => (
                <li key={rule}>· {rule}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
