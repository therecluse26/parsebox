import { sizeLabel } from "@/lib/convert/measure";

interface Props {
  /** Characters in the full input */
  chars: number;
  /** Characters shown in the read-only preview */
  shown: number;
  onClear: () => void;
}

// One line for the input pane when the input is too large to edit: "large input · 20.4 MB · editing off"
export function LargeInputNotice({ chars, shown, onClear }: Props) {
  const size = `${(chars / 1_000_000).toFixed(1)} MB`;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="min-w-0 truncate text-primary" title={`large input · ${size} · editing off · showing first ${sizeLabel(shown)}`}>
        large input · {size} · editing off
        <span className="text-dim"> · showing first {sizeLabel(shown)}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        clear
      </button>
    </div>
  );
}
