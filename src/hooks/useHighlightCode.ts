import { useState, useEffect } from 'react';

// highlight.js is loaded from CDN (see index.html)
// @ts-ignore
declare const hljs: any;

export function useHighlightCode(code: string, language: string, delay: number = 150) {
  const [debouncedCode, setDebouncedCode] = useState(code);
  const [highlightedCode, setHighlightedCode] = useState(code);

  // Debounce the code changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCode(code);
    }, delay);

    return () => clearTimeout(timer);
  }, [code, delay]);

  // Highlight only the debounced code
  useEffect(() => {
    if (!debouncedCode || !language) {
      setHighlightedCode(debouncedCode);
      return;
    }

    // Check if hljs is available (loaded from CDN)
    if (typeof hljs === 'undefined') {
      console.warn('highlight.js not loaded yet');
      setHighlightedCode(debouncedCode);
      return;
    }

    try {
      const highlighted = hljs.highlight(debouncedCode, { language }).value;
      setHighlightedCode(highlighted);
    } catch (error) {
      console.error('Highlighting error:', error);
      setHighlightedCode(debouncedCode); // Fallback to plain text
    }
  }, [debouncedCode, language]);

  return highlightedCode;
}
