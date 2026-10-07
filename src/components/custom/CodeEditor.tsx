import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Annotation, Compartment, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, keymap, lineNumberMarkers, lineNumbers, placeholder as placeholderText } from "@codemirror/view";
import { codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { editorHighlighting, editorTheme } from "./editorTheme";
import { loadSyntax } from "@/lib/editor/languages";

export interface CodeEditorHandle {
  /** Put the caret on a 1-based line and column, scroll it into view and focus the editor */
  jumpTo(line: number, column: number): void;
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  /** Read-only text can still take focus, so a paste or a drop reaches the handlers below */
  readOnly: boolean;
  /** The format `value` that picks the highlighting and folding; null for plain text */
  format: string | null;
  /** 1-based line whose number shows in the error colour */
  errorLine?: number;
  placeholder: string;
  /** Return true to take over a paste of `text` over the selection from `from` to `to` */
  onPasteText?: (text: string, from: number, to: number) => boolean;
  /** Return true to take over a drop of `text` */
  onDropText?: (text: string) => boolean;
  ariaLabel: string;
}

class ErrorNumber extends GutterMarker {
  constructor(readonly line: number) {
    super();
  }
  eq(other: ErrorNumber) {
    return other.line === this.line;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-errorLineNumber";
    span.textContent = String(this.line);
    return span;
  }
}

// Marks the replace that follows a new `value`, so it does not echo back through onChange
const outsideChange = Annotation.define<boolean>();

const setErrorLine = StateEffect.define<number | undefined>();
const errorLineField = StateField.define<number | undefined>({
  create: () => undefined,
  update: (line, tr) => tr.effects.reduce((value, effect) => (effect.is(setErrorLine) ? effect.value : value), line),
});
// A marker with its own DOM replaces the line number, so the error number keeps its tight highlight
const errorNumber = lineNumberMarkers.compute(["doc", errorLineField], (state) => {
  const line = state.field(errorLineField);
  if (line === undefined || line > state.doc.lines) return RangeSet.empty;
  return RangeSet.of(new ErrorNumber(line).range(state.doc.line(line).from));
});

const chevron = (open: boolean) => {
  const marker = document.createElement("span");
  marker.className = "cm-foldMarker";
  if (!open) marker.dataset.folded = "";
  marker.innerHTML = open
    ? '<svg viewBox="0 0 8 8" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 2.5 4 5.5 7 2.5"/></svg>'
    : '<svg viewBox="0 0 8 8" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 1 5.5 4 2.5 7"/></svg>';
  return marker;
};

/**
 * One pane's text. CodeMirror draws only the lines in view, so the cost of a
 * render does not grow with the text. `value` is the source of truth: an outside
 * change replaces the whole document, and an edit calls onChange.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(
  ({ value, onChange, readOnly, format, errorLine, placeholder, onPasteText, onDropText, ariaLabel }, ref) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // The text the document last held for `value`, so an echo of our own edit does not replace the document
    const syncedRef = useRef(value);
    const compartments = useRef({ language: new Compartment(), readOnly: new Compartment(), history: new Compartment() })
      .current;
    // The handlers change every render; the view reads the latest through this ref
    const handlers = useRef({ onChange, onPasteText, onDropText, readOnly });
    handlers.current = { onChange, onPasteText, onDropText, readOnly };

    useEffect(() => {
      const view = new EditorView({
        parent: hostRef.current!,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            foldGutter({ markerDOM: chevron }),
            codeFolding({ placeholderText: "…" }),
            errorLineField,
            errorNumber,
            compartments.history.of(history()),
            keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
            placeholderText(placeholder),
            editorTheme,
            editorHighlighting,
            compartments.language.of([]),
            compartments.readOnly.of(EditorState.readOnly.of(readOnly)),
            EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false" }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || update.transactions.some((tr) => tr.annotation(outsideChange))) return;
              const text = update.state.doc.toString();
              syncedRef.current = text;
              handlers.current.onChange?.(text);
            }),
            EditorView.domEventHandlers({
              paste(event, view) {
                const text = event.clipboardData?.getData("text/plain");
                const { from, to } = view.state.selection.main;
                if (!text || !handlers.current.onPasteText?.(text, from, to)) return false;
                event.preventDefault();
                return true;
              },
              drop(event) {
                const text = event.dataTransfer?.getData("text/plain");
                if (!text || !handlers.current.onDropText?.(text)) return false;
                event.preventDefault();
                return true;
              },
              // Read-only text refuses drops unless dragover is cancelled
              dragover(event) {
                if (handlers.current.readOnly && handlers.current.onDropText) event.preventDefault();
                return false;
              },
            }),
          ],
        }),
      });
      viewRef.current = view;
      return () => view.destroy();
      // The view lives as long as the pane; the effects below update it
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || value === syncedRef.current) return;
      syncedRef.current = value;
      // A new text starts a new undo history, so undo never brings back a large input's preview
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: outsideChange.of(true),
        effects: compartments.history.reconfigure([]),
      });
      view.dispatch({ effects: compartments.history.reconfigure(history()) });
    }, [value, compartments]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly)) });
    }, [readOnly, compartments]);

    useEffect(() => {
      let current = true;
      loadSyntax(format).then((extension) => {
        if (current) viewRef.current?.dispatch({ effects: compartments.language.reconfigure(extension) });
      });
      return () => {
        current = false;
      };
    }, [format, compartments]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: setErrorLine.of(errorLine) });
    }, [errorLine]);

    useImperativeHandle(ref, () => ({
      jumpTo(line, column) {
        const view = viewRef.current;
        if (!view) return;
        const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        const caret = Math.min(target.from + Math.max(column - 1, 0), target.to);
        view.dispatch({ selection: { anchor: caret }, effects: EditorView.scrollIntoView(caret, { y: "center" }) });
        view.focus();
      },
    }));

    return <div ref={hostRef} className="h-full w-full font-mono" />;
  }
);
CodeEditor.displayName = "CodeEditor";
