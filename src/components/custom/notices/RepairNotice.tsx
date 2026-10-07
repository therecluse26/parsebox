import * as Popover from "@radix-ui/react-popover";
import type { RepairInfo } from "@/lib/convert/types";

// One line for the input pane when repair made invalid input parse; the fixes open on click or tap
export function RepairNotice({ repair }: { repair: RepairInfo | null }) {
  if (!repair) return null;

  const format = repair.format.toLowerCase();
  const count = `${repair.fixCount.toLocaleString("en-US")} ${repair.fixCount === 1 ? "fix" : "fixes"}`;

  return (
    <div className="flex min-w-0 items-center text-xs">
      <Popover.Root>
        <Popover.Trigger
          className="min-w-0 truncate rounded-sm text-left text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`repaired invalid ${format}, ${count}: show the fixes`}
        >
          ⚠ repaired invalid {format} · {count}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-input bg-popover p-3 text-xs text-popover-foreground shadow-lg shadow-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          >
            <ul className="space-y-1">
              {repair.fixes.map((fix) => (
                <li key={fix} className="flex gap-2">
                  <span className="text-dim">·</span>
                  <span className="break-words">{fix}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">the output is a best guess; check it</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
