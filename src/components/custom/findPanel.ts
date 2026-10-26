/**
 * The find bar at the top of a pane. It is a custom panel for @codemirror/search,
 * which keeps the query and highlights the matches. The bar searches as you type,
 * counts the matches and has case and regex toggles; it has no replace.
 */
import type { EditorState } from "@codemirror/state";
import type { Command, KeyBinding, Panel, ViewUpdate } from "@codemirror/view";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { findMatches, matchLabel, type Matches } from "@/lib/editor/find";
import { LIMITS } from "@/config/limits";

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;

/** Open the find bar, or focus it and select its text when it is already open */
export const openFindPanel: Command = (view) => {
  const field = view.dom.querySelector<HTMLInputElement>(".cm-find input");
  if (!field) return openSearchPanel(view);
  field.focus();
  field.select();
  return true;
};

/** Mod-f, F3 and Mod-g (Shift for the previous match) and Escape, from the text and from the bar */
export const findKeymap: KeyBinding[] = [
  { key: "Mod-f", run: openFindPanel, scope: "editor search-panel" },
  { key: "F3", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
  { key: "Mod-g", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
  { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
];

class FindPanel implements Panel {
  readonly dom = document.createElement("div");
  readonly top = true;
  private readonly field = document.createElement("input");
  private readonly count = document.createElement("span");
  private readonly caseToggle: HTMLButtonElement;
  private readonly regexToggle: HTMLButtonElement;
  private matches: Matches = { ranges: [], more: false };

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-find";
    this.dom.addEventListener("keydown", (event) => this.keydown(event));

    this.field.placeholder = "find";
    this.field.setAttribute("aria-label", "Find");
    this.field.spellcheck = false;
    this.field.addEventListener("input", () => this.commit({ search: this.field.value }));

    this.count.className = "cm-findCount";
    this.caseToggle = this.button("Aa", "Match case", () =>
      this.commit({ caseSensitive: !getSearchQuery(view.state).caseSensitive })
    );
    this.regexToggle = this.button(".*", "Regular expression", () =>
      this.commit({ regexp: !getSearchQuery(view.state).regexp })
    );

    this.dom.append(
      this.field,
      this.count,
      this.caseToggle,
      this.regexToggle,
      this.button(icon("m18 15-6-6-6 6"), "Previous match (Shift+Enter)", () => findPrevious(view)),
      this.button(icon("m6 9 6 6 6-6"), "Next match (Enter)", () => findNext(view)),
      this.button(icon("M18 6 6 18M6 6l12 12"), "Close (Escape)", () => closeSearchPanel(view))
    );
    this.refresh(true);
  }

  mount() {
    this.field.focus();
    this.field.select();
  }

  update(update: ViewUpdate) {
    const queryChanged = !getSearchQuery(update.state).eq(getSearchQuery(update.startState));
    if (queryChanged || update.docChanged || update.selectionSet) this.refresh(queryChanged || update.docChanged);
  }

  private button(content: string, label: string, onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = content;
    button.title = label;
    button.setAttribute("aria-label", label);
    // The focus stays in the field, so Enter still steps through the matches
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", onClick);
    return button;
  }

  private keydown(event: KeyboardEvent) {
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
    } else if (event.key === "Enter" && event.target === this.field) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
      // findNext selects the field's text; a caret at the end lets the next keystroke refine the query
      this.field.setSelectionRange(this.field.value.length, this.field.value.length);
    }
  }

  // A new query searches as you type: it selects the first match from the selection start
  private commit(spec: { search?: string; caseSensitive?: boolean; regexp?: boolean }) {
    const { state } = this.view;
    const current = getSearchQuery(state);
    const query = new SearchQuery({
      search: current.search,
      caseSensitive: current.caseSensitive,
      regexp: current.regexp,
      ...spec,
    });
    if (query.eq(current)) return;
    const match = query.valid ? firstMatch(query, state, state.selection.main.from) : null;
    this.view.dispatch({
      effects: match ? [setSearchQuery.of(query), EditorView.scrollIntoView(match.from)] : setSearchQuery.of(query),
      selection: match ? { anchor: match.from, head: match.to } : undefined,
      userEvent: "select.search",
    });
  }

  /** Show the query in the bar and the count; `rescan` finds the matches again first */
  private refresh(rescan: boolean) {
    const { state } = this.view;
    const query = getSearchQuery(state);
    if (this.field.value !== query.search) this.field.value = query.search;
    this.caseToggle.setAttribute("aria-pressed", String(query.caseSensitive));
    this.regexToggle.setAttribute("aria-pressed", String(query.regexp));
    if (rescan) this.matches = query.valid ? findMatches(state, query, LIMITS.findMaxMatches) : { ranges: [], more: false };

    // An empty query is not valid either; only a regex can fail to compile
    const invalid = !query.valid && query.search !== "";
    this.count.textContent = invalid ? "invalid regex" : query.valid ? matchLabel(this.matches, state.selection.main) : "";
    this.count.toggleAttribute("data-error", invalid);
  }
}

/** The first match at or after `from`, else the first in the text */
function firstMatch(query: SearchQuery, state: EditorState, from: number) {
  const after = query.getCursor(state, from).next();
  if (!after.done) return after.value;
  const first = query.getCursor(state).next();
  return first.done ? null : first.value;
}

export const findPanel = search({ top: true, createPanel: (view) => new FindPanel(view) });
