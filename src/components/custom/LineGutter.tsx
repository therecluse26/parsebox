import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

interface Props {
  count: number;
  /** 1-based line to highlight, for example the line of a parse error */
  errorLine?: number;
}

// Lines drawn beyond each edge of the view, so a fast scroll does not show a blank gutter
const OVERSCAN = 40;
// The fallback for text-sm with leading-[1.5]; the real value is read from the style
const DEFAULT_LINE_HEIGHT = 21;

/**
 * Line numbers beside an editor. The parent syncs scrollTop with the editor; the
 * gutter draws only the numbers in view, so a render costs O(visible lines).
 */
export const LineGutter = forwardRef<HTMLDivElement, Props>(({ count, errorLine }, ref) => {
  const boxRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => boxRef.current as HTMLDivElement);
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  // The drawn lines: `rows` lines from 0-based line `start`
  const [range, setRange] = useState({ start: 0, rows: 2 * OVERSCAN });

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const style = getComputedStyle(box);
    const height = parseFloat(style.lineHeight) || DEFAULT_LINE_HEIGHT;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    setLineHeight(height);

    // Redraw only when the view leaves the drawn lines' inner part, in steps of OVERSCAN lines
    const update = (sync: boolean) => {
      const first = Math.max(0, Math.floor((box.scrollTop - paddingTop) / height));
      const start = Math.max(0, Math.floor(first / OVERSCAN) * OVERSCAN - OVERSCAN);
      const rows = Math.ceil(box.clientHeight / height) + 3 * OVERSCAN;
      const apply = () =>
        setRange((previous) => (previous.start === start && previous.rows === rows ? previous : { start, rows }));
      // Draw before the next paint, so the numbers never lag the text
      if (sync) flushSync(apply);
      else apply();
    };
    const onScroll = () => update(true);
    const observer = new ResizeObserver(() => update(false));
    observer.observe(box);
    box.addEventListener("scroll", onScroll, { passive: true });
    update(false);
    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", onScroll);
    };
    // Again when the count changes: a shorter text can clamp the scroll position
  }, [count]);

  const start = Math.min(range.start, Math.max(0, count - 1));
  const end = Math.min(count, start + range.rows);
  let numbers = "";
  let errorAt = -1;
  for (let line = start + 1; line <= end; line++) {
    if (line > start + 1) numbers += "\n";
    if (line === errorLine) errorAt = numbers.length;
    numbers += line;
  }

  // Three text pieces, not one node per line: numbers before, the error line, numbers after
  let content: ReactNode = numbers;
  if (errorAt !== -1) {
    content = (
      <>
        {numbers.slice(0, errorAt)}
        <span className="-mx-1 rounded-sm bg-destructive/15 px-1 text-destructive">{errorLine}</span>
        {numbers.slice(errorAt + String(errorLine).length)}
      </>
    );
  }

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      className="shrink-0 select-none overflow-hidden pb-6 pt-3 pl-3.5 pr-3 text-right font-mono text-sm leading-[1.5] text-gutter"
    >
      {/* Full height, so the gutter scrolls as far as the editor; as wide as the longest number */}
      <div className="relative" style={{ height: count * lineHeight, width: `${String(count).length}ch` }}>
        <pre className="absolute inset-x-0 m-0 font-mono" style={{ top: start * lineHeight }}>
          {content}
        </pre>
      </div>
    </div>
  );
});
LineGutter.displayName = "LineGutter";
