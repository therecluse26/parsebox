import React, { useRef, useEffect } from 'react';
import { useHighlightCode } from '@/hooks/useHighlightCode';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: string;
  readOnly: boolean;
  className?: string;
  placeholder?: string;
}

export function SyntaxHighlightedEditor({
  value,
  onChange,
  language,
  readOnly,
  className,
  placeholder
}: Props) {
  const highlightedCode = useHighlightCode(value, language);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // Sync scrolling between textarea and overlay
  useEffect(() => {
    const textarea = textareaRef.current;
    const pre = preRef.current;
    if (!textarea || !pre) return;

    const handleScroll = () => {
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
    };

    textarea.addEventListener('scroll', handleScroll);
    return () => textarea.removeEventListener('scroll', handleScroll);
  }, []);

  if (readOnly) {
    // Read-only: just show highlighted code
    return (
      <div
        className={cn("h-full w-full overflow-hidden", className)}
        style={{ height: '100%', maxHeight: '100%' }}
      >
        <pre
          className="hljs h-full w-full p-3 overflow-auto font-mono text-sm scrollbar-thin scrollbar-thumb-primary scrollbar-track-background"
          style={{ height: '100%', maxHeight: '100%' }}
        >
          <code
            className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
      </div>
    );
  }

  // Editable: overlay technique
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {/* Highlighted overlay */}
      <pre
        ref={preRef}
        className="hljs absolute inset-0 p-3 overflow-auto font-mono text-sm pointer-events-none scrollbar-thin scrollbar-thumb-primary scrollbar-track-background"
        style={{
          maxHeight: '100%',
          height: '100%',
          display: 'block'
        }}
        aria-hidden="true"
      >
        <code
          className={`language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>

      {/* Transparent textarea for editing */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 p-3 bg-transparent resize-none font-mono text-sm
                   text-transparent outline-none overflow-auto
                   scrollbar-thin scrollbar-thumb-primary scrollbar-track-background"
        style={{
          caretColor: 'hsl(var(--foreground))',
          maxHeight: '100%',
          height: '100%'
        }}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
