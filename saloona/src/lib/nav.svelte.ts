/**
 * Navigation on top of the History API, so Android's back button (WebView goBack)
 * closes sheets and leaves sub-pages naturally.
 */
export type Tab = 'due' | 'clients' | 'money' | 'more';

export type Page =
  | { name: 'client'; id: string }
  | { name: 'backup' }
  | { name: 'security' }
  | { name: 'privacy' }
  | { name: 'about' }
  | { name: 'missing' }
  | { name: 'calendar'; day?: string }
  | { name: 'treatments' };

export type Sheet =
  | { name: 'visit'; visitId?: string; clientId?: string; prefillName?: string; date?: string }
  | { name: 'treatment'; key?: string; prefillName?: string }
  | { name: 'client'; clientId?: string; prefillName?: string };

export interface NavState {
  tab: Tab;
  pages: Page[];
  sheet: Sheet | null;
}

interface HistoryEntry {
  saloona: 1;
  nav: NavState;
  depth: number;
}

function isEntry(v: unknown): v is HistoryEntry {
  return typeof v === 'object' && v !== null && (v as { saloona?: unknown }).saloona === 1;
}

class Nav {
  state = $state<NavState>({ tab: 'due', pages: [], sheet: null });
  private depth = 0;
  private pendingTab: Tab | null = null;

  get page(): Page | null {
    return this.state.pages[this.state.pages.length - 1] ?? null;
  }

  init(): void {
    const existing: unknown = history.state;
    if (isEntry(existing)) {
      // Preview reload: start from the root of the saved tab.
      this.state = { tab: existing.nav.tab, pages: [], sheet: null };
    }
    history.replaceState(this.entry(0), '');
    window.addEventListener('popstate', (e) => this.onPop(e.state));
  }

  private entry(depth: number): HistoryEntry {
    return { saloona: 1, nav: $state.snapshot(this.state) as NavState, depth };
  }

  private onPop(raw: unknown): void {
    if (!isEntry(raw)) return;
    this.depth = raw.depth;
    this.state = raw.nav;
    if (this.pendingTab && this.depth === 0) {
      const tab = this.pendingTab;
      this.pendingTab = null;
      this.state = { tab, pages: [], sheet: null };
      history.replaceState(this.entry(0), '');
      window.scrollTo(0, 0);
    }
  }

  private push(next: NavState): void {
    this.state = next;
    this.depth += 1;
    history.pushState(this.entry(this.depth), '');
  }

  switchTab(tab: Tab): void {
    if (this.depth > 0) {
      this.pendingTab = tab;
      history.go(-this.depth);
      return;
    }
    this.state = { tab, pages: [], sheet: null };
    history.replaceState(this.entry(0), '');
    window.scrollTo(0, 0);
  }

  open(page: Page): void {
    this.push({ tab: this.state.tab, pages: [...this.state.pages, page], sheet: null });
    window.scrollTo(0, 0);
  }

  openSheet(sheet: Sheet): void {
    if (this.state.sheet) {
      // Replace the sheet in place (e.g. from a client sheet to a visit sheet).
      this.state = { ...this.state, sheet };
      history.replaceState(this.entry(this.depth), '');
      return;
    }
    this.push({ ...this.state, sheet });
  }

  /**
   * Replaces the open sheet with a page in the same history entry
   * (e.g. "Opret kunde" → the new client's page), so back returns to where the sheet was opened.
   */
  replaceSheetWithPage(page: Page): void {
    if (!this.state.sheet) {
      this.open(page);
      return;
    }
    this.state = { tab: this.state.tab, pages: [...this.state.pages, page], sheet: null };
    history.replaceState(this.entry(this.depth), '');
    window.scrollTo(0, 0);
  }

  /** Same as the Android back button. */
  back(): void {
    if (this.depth > 0) history.back();
  }

  /** After deleting what a page shows: go back without leaving a stale page. */
  closeSheet(): void {
    if (this.state.sheet) this.back();
  }
}

export const nav = new Nav();
