import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { SecretFinding } from "@/lib/convert/types";
import { LIMITS } from "@/config/limits";
import { cn } from "@/lib/utils";

interface Props {
  /** Null when the scan did not run */
  secrets: SecretFinding[] | null;
  redact: boolean;
  onRedactChange: (redact: boolean) => void;
}

const RULE_LABELS: Record<SecretFinding["rule"], string> = {
  prefix: "known token format",
  "key-name": "key name",
  entropy: "random-looking value",
};

const focusRing = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// A thin row in the input pane: "⚠ 3 possible secrets", an expandable list and the redact switch
export function SecretsNotice({ secrets, redact, onRedactChange }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!secrets || secrets.length === 0) return null;

  const count = secrets.length;
  const more = count >= LIMITS.secretsMaxFindings ? "+" : "";
  const label = `${count}${more} possible secret${count === 1 ? "" : "s"}`;

  return (
    <div className="border-t text-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-3.5 py-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen(!open)}
          className={cn("flex min-w-0 items-center gap-1.5 py-1 text-primary hover:text-primary/80", focusRing)}
        >
          <span aria-hidden>⚠</span>
          <span className="truncate">{label}</span>
          <ChevronRight
            aria-hidden
            className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={redact}
          onClick={() => onRedactChange(!redact)}
          className={cn("flex items-center gap-2 py-1 text-muted-foreground hover:text-foreground", focusRing)}
        >
          redact in output
          <span
            aria-hidden
            className={cn(
              "relative h-3.5 w-6 shrink-0 rounded-full border transition-colors",
              redact ? "border-primary bg-primary" : "border-input bg-popover",
            )}
          >
            <span
              className={cn(
                "absolute left-px top-px h-2.5 w-2.5 rounded-full transition-transform",
                redact ? "translate-x-2.5 bg-primary-foreground" : "bg-muted-foreground",
              )}
            />
          </span>
        </button>
      </div>
      {open && (
        <div id={listId} className="border-t px-3.5 py-2">
          <ul aria-label="possible secrets" className="max-h-40 space-y-1 overflow-y-auto">
            {secrets.map((secret, i) => (
              <li
                key={i}
                title={`looks like a ${secret.kind} (${RULE_LABELS[secret.rule]})`}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2"
              >
                <span className="text-foreground">{secret.kind}</span>
                <span className="min-w-0 truncate text-muted-foreground">{secret.path || "text"}</span>
                <span className="text-dim">{secret.preview}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-dim">
            these look like secrets by format, key name or randomness; they may not be. checked in
            your browser, nothing is sent.
          </p>
        </div>
      )}
    </div>
  );
}
