import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatGroupLabels, formatOptions } from "@/config/formats";
import type { FormatGroup, FormatOption } from "@/config/formats";
import { cn } from "@/lib/utils";

interface Props {
  side: "in" | "out";
  value: string;
  onChange: (value: string) => void;
  /** Label of the detected format, shown beside "Auto Detect" */
  detectedFormat?: string | null;
}

const groupOrder = Object.keys(formatGroupLabels) as FormatGroup[];

// Ranks a format against the search: whole term, then term start, then word start, then anywhere.
// The terms are the value, label and aliases, so "ts", "golang" and "pydantic" find their formats.
function matchScore(option: FormatOption, query: string): number {
  let best = 0;
  for (const term of [option.value, option.label, ...(option.aliases ?? [])]) {
    const text = term.toLowerCase();
    let score = 0;
    if (text === query) score = 4;
    else if (text.startsWith(query)) score = 3;
    else if (text.split(/[\s()/-]+/).some((word) => word.startsWith(query))) score = 2;
    else if (text.includes(query)) score = 1;
    best = Math.max(best, score);
  }
  return best;
}

interface OptionGroup {
  group: FormatGroup;
  options: FormatOption[];
}

// Matching formats, best first; groups ordered by their best match.
// cmdk's own sort cannot reorder groups (1.1.1), so the list is ranked here.
function rank(groups: OptionGroup[], search: string): OptionGroup[] {
  const query = search.trim().toLowerCase();
  if (!query) return groups;
  return groups
    .map(({ group, options }) => {
      const scored = options
        .map((option) => ({ option, score: matchScore(option, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      return { group, options: scored.map(({ option }) => option), best: scored[0]?.score ?? 0 };
    })
    .filter(({ options }) => options.length > 0)
    .sort((a, b) => b.best - a.best);
}

// The format picker in each pane header: a searchable list grouped by kind.
// The in side hides output-only formats; the out side hides input-only ones.
export function FormatSelect({ side, value, onChange, detectedFormat }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // The highlighted item; starts on the current format
  const [active, setActive] = useState(value);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo((): OptionGroup[] => {
    const options = formatOptions.filter((option) => option.io === "both" || (side === "in" ? option.io === "input" : option.io === "output"));
    return groupOrder
      .map((group) => ({ group, options: options.filter((option) => option.group === group) }))
      .filter(({ options }) => options.length > 0);
  }, [side]);

  const shown = useMemo(() => rank(groups, search), [groups, search]);

  const current = formatOptions.find((option) => option.value === value);
  const name = side === "in" ? "input format" : "output format";
  const detected = (format: string) =>
    format === "auto" && detectedFormat ? <span className="text-primary"> → {detectedFormat}</span> : null;

  // Searching highlights the best match; an empty search highlights the current format
  const updateSearch = (next: string) => {
    setSearch(next);
    setActive(next.trim() ? (rank(groups, next)[0]?.options[0]?.value ?? "") : value);
  };

  const show = (initialSearch: string) => {
    updateSearch(initialSearch);
    setOpen(true);
  };

  // Keep the current format in view when the list opens
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector('[cmdk-item][data-selected="true"]')?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Arrows open the list; typing on the closed trigger opens it and starts the search
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show("");
    } else if (event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      show(event.key);
    }
  };

  const select = (next: string) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={(next) => (next ? show("") : setOpen(false))}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${name}: ${current?.label ?? value}`.toLowerCase()}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            "h-8 w-auto gap-2 rounded border-input bg-popover px-2.5 text-[13px] lowercase"
          )}
        >
          <span>
            {current?.label ?? value}
            {detected(value)}
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-60 max-w-[calc(100vw-1rem)] p-0 lowercase"
        // Radix would select the search text, and the next key typed would replace the first one
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = inputRef.current;
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        }}
      >
        <Command shouldFilter={false} value={active} onValueChange={setActive} loop label={name}>
          <CommandInput ref={inputRef} value={search} onValueChange={updateSearch} placeholder="search formats..." aria-label={`search ${name}s`} />
          <CommandList ref={listRef} label={`${name}s`} className="max-h-[min(320px,50vh)]">
            <CommandEmpty>no matching format</CommandEmpty>
            {shown.map(({ group, options }) => (
              <CommandGroup key={group} heading={formatGroupLabels[group]}>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={select}
                  >
                    <span className="flex-1 truncate">
                      {option.label}
                      {detected(option.value)}
                    </span>
                    {option.value === value && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
