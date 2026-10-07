import React from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** highlight.js HTML, made in the conversion worker */
  html: string;
  onScroll?: (e: React.UIEvent<HTMLElement>) => void;
  className?: string;
}

// Read-only highlighted output. highlight.js escapes the text, so the HTML is safe to insert.
export function SyntaxHighlightedEditor({ html, onScroll, className }: Props) {
  return (
    <div className={cn("h-full w-full overflow-hidden", className)}>
      <pre
        className="hljs h-full w-full overflow-auto whitespace-pre py-3 pl-1 pr-3 font-mono text-sm leading-[1.5] focus-visible:outline-none"
        onScroll={onScroll}
        tabIndex={0}
      >
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
