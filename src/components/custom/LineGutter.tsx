import { forwardRef, useMemo, type ReactNode } from "react";

interface Props {
  count: number;
  /** 1-based line to highlight, for example the line of a parse error */
  errorLine?: number;
}

// Line numbers beside an editor; the parent syncs scrollTop with the editor
export const LineGutter = forwardRef<HTMLDivElement, Props>(({ count, errorLine }, ref) => {
  const numbers = useMemo(
    () => Array.from({ length: count }, (_, i) => i + 1).join("\n"),
    [count]
  );

  // Three text pieces, not one node per line: numbers before, the error line, numbers after
  let content: ReactNode = numbers;
  if (errorLine !== undefined && Number.isInteger(errorLine) && errorLine >= 1 && errorLine <= count) {
    const start = offsetOfLine(errorLine);
    const end = start + String(errorLine).length;
    content = (
      <>
        {numbers.slice(0, start)}
        <span className="-mx-1 rounded-sm bg-destructive/15 px-1 text-destructive">{errorLine}</span>
        {numbers.slice(end)}
      </>
    );
  }

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="shrink-0 select-none overflow-hidden pb-6 pt-3 pl-3.5 pr-3 text-right font-mono text-sm leading-[1.5] text-gutter"
    >
      <pre className="m-0 font-mono">{content}</pre>
    </div>
  );
});
LineGutter.displayName = "LineGutter";

// Where line `line` starts in "1\n2\n3...": each earlier number plus its newline
function offsetOfLine(line: number): number {
  let offset = 0;
  let digits = 1;
  let first = 1; // the first number with `digits` digits
  while (first * 10 <= line - 1) {
    offset += 9 * first * (digits + 1);
    first *= 10;
    digits++;
  }
  return offset + (line - first) * (digits + 1);
}
