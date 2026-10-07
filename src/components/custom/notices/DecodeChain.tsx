import { Fragment } from "react";
import { formatLabel } from "@/config/formats";
import type { DecodeStep } from "@/lib/convert/types";

// The layers removed in auto mode, outermost first: "decoded: base64 › gzip › json"
export function DecodeChain({ steps, innerFormat }: { steps: DecodeStep[]; innerFormat: string | null }) {
  if (steps.length === 0) return null;

  const inner = innerFormat ? (formatLabel(innerFormat) ?? innerFormat) : null;
  const crumbs = [...steps.map((step) => step.label), ...(inner ? [inner] : [])];

  return (
    <div
      aria-label="decode chain"
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b px-3.5 py-1 text-xs text-dim"
    >
      <span>decoded:</span>
      {crumbs.map((crumb, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">›</span>}
          <span className={i === crumbs.length - 1 && inner ? "text-primary" : "text-foreground"}>
            {crumb.toLowerCase()}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
