import { forwardRef, useMemo } from "react";

interface Props {
  count: number;
}

// Line numbers beside an editor; the parent syncs scrollTop with the editor
export const LineGutter = forwardRef<HTMLDivElement, Props>(({ count }, ref) => {
  const numbers = useMemo(
    () => Array.from({ length: count }, (_, i) => i + 1).join("\n"),
    [count]
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="shrink-0 select-none overflow-hidden pb-6 pt-3 pl-3.5 pr-3 text-right font-mono text-sm leading-[1.5] text-gutter"
    >
      <pre className="m-0 font-mono">{numbers}</pre>
    </div>
  );
});
LineGutter.displayName = "LineGutter";
