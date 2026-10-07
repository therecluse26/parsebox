import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatOptions } from "@/config/formats";

interface Props {
  side: "in" | "out";
  value: string;
  onChange: (value: string) => void;
  /** Label of the detected format, shown beside "Auto Detect" */
  detectedFormat?: string | null;
}

// The format picker in each pane header. The in side hides output-only formats; the out side hides input-only ones.
export function FormatSelect({ side, value, onChange, detectedFormat }: Props) {
  const options = formatOptions.filter((option) => option.io === "both" || (side === "in" ? option.io === "input" : option.io === "output"));

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto gap-2 rounded border-input bg-popover px-2.5 text-[13px] lowercase">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="lowercase">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            {option.value === "auto" && detectedFormat && (
              <span className="text-primary"> → {detectedFormat}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
