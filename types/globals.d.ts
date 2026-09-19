// Ambient declarations for ts-check. YAZIT ships zero runtime deps;
// `TL` is a global injected by common.js into every context. TLApi below is
// the real public contract — keep it in sync with common.js exports so
// `npm run typecheck` actually verifies call sites instead of `any`-passing.
export {};

declare global {
  interface TLField {
    name: string;
    label: string;
    type: "text" | "multiline" | "dropdown" | "date" | "checkbox";
    def: string;
    options: string[];
    remember: boolean;
    required?: boolean;
  }

  interface TLTemplate {
    id: string;
    order: number;
    name: string;
    shortcut: string;
    body: string;
    tags?: string[];
    format?: "text" | "html";
    /** Absent or dangling === uncategorized */
    folderId?: string;
    favorite?: boolean;
  }

  interface TLFolder {
    id: string;
    name: string;
    order: number;
  }

  interface TLBackup {
    ts: number;
    schemaVersion: number;
    count: number;
    templates: TLTemplate[];
    /** v4+; absent in older snapshots */
    folders?: TLFolder[];
  }

  interface TLImportSummary {
    accepted: Array<Pick<TLTemplate, "name" | "shortcut" | "body" | "tags" | "format" | "favorite"> & { folder?: string }>;
    rejected: number;
    truncated: number;
  }

  interface TLDebounced<F extends (...args: any[]) => any> {
    (...args: Parameters<F>): void;
    /** Run any pending invocation now and clear the timer (no-op if idle). */
    flush(): void;
    /** Drop any pending invocation without running it. */
    cancel(): void;
  }

  interface TLEditorAdapter {
    exec(command: string, value?: string): boolean;
    insertText(text: string): boolean;
    insertHtml(html: string): boolean;
    createLink(url: string): boolean;
    setParagraphSeparator(sep: string): boolean;
  }

  interface TLApi {
    // Limits / schema
    LIMITS: Readonly<{
      MAX_TEMPLATES: number; MAX_NAME: number; MAX_SHORTCUT: number;
      MAX_BODY: number; MAX_TAGS: number; MAX_TAG_LEN: number;
      MAX_FIELDS: number; MAX_OPTIONS: number; MAX_BACKUPS: number;
      MAX_IMPORT_BYTES: number; MAX_FOLDERS: number; MAX_FOLDER_NAME: number;
    }>;
    CURRENT_SCHEMA: number;

    // i18n
    /** Resolves to the concrete locale in effect ("auto" -> "tr" | "en"). */
    loadLocale(langPref?: string): Promise<string>;
    normalizeTheme(v: unknown): "auto" | "light" | "dark";
    tokenKind(inner: string): { kind: "field" | "control" | "dynamic"; name: string };
    PH_SLOTS: number;
    placeholderSlots(text: string): Map<string, number>;
    folderSlots(folders: { id: string }[]): Map<string, number>;
    placeholderKey(inner: string, slots: Map<string, number>): string;
    checkConditionals(text: string): null | { code: "unclosed" | "nested" | "strayElse" | "strayClose" | "doubleElse" | "noName"; name?: string };
    buildCondition(spec: { name: string; equals?: string }): { open: string; otherwise: string; close: string } | null;
    t(key: string, subs?: string[] | string): string;

    // Escaping / sanitizing
    escapeHtml(str: unknown): string;
    sanitizeFilename(name: unknown): string;
    ALLOWED_TAGS: ReadonlySet<string>;
    KILL_TAGS: ReadonlySet<string>;
    sanitizeHtml(dirty: unknown): string;
    tidyHtml(safeHtml: unknown): string;
    htmlToFragment(safeHtml: string): DocumentFragment;
    htmlToPlainText(html: unknown): string;
    cleanHref(href: unknown): string | null;
    /** Pure geometry: does any sample point inside the rect's on-screen part hit the element? */
    visibleHit(
      rect: { left: number; top: number; width: number; height: number },
      viewport: { width: number; height: number },
      hitAt: (x: number, y: number) => boolean
    ): boolean;

    // Editor backend
    editorAdapter: TLEditorAdapter;

    // Shortcuts
    SHORTCUT_CHARS: string;
    SHORTCUT_STRIP_RE: RegExp;
    stripShortcut(s: unknown): string;
    slashRegex(): RegExp;

    // Hashing / migration
    fnv1a(str: unknown): string;
    migrate(store: unknown): { schemaVersion: number; templates: TLTemplate[]; [k: string]: any };
    normalizeTags(tags: unknown): string[];

    // Storage
    getTemplates(): Promise<TLTemplate[]>;
    getFolders(): Promise<TLFolder[]>;
    setFolders(folders: unknown[]): Promise<TLFolder[]>;
    normalizeFolders(raw: unknown): TLFolder[];
    cleanFolderName(name: unknown): string;
    makeFolderId(): string;
    folderOf(tpl: { folderId?: string }, folderIds: Set<string>): string;
    normalizeTemplates(templates: unknown[]): TLTemplate[];
    setTemplates(templates: unknown[]): Promise<TLTemplate[]>;
    getLastValues(templateId: string): Promise<Record<string, string>>;
    saveLastValues(templateId: string, values: Record<string, string>): Promise<void>;
    clearLastValues(templateId: string): Promise<void>;
    gcLastValues(validIds: string[]): Promise<void>;
    migrateLastValues(): Promise<void>;
    purgeSecretLastValues(): Promise<void>;
    getLang(): Promise<string>;
    setLang(lang: string): Promise<void>;
    getTheme(): Promise<"auto" | "light" | "dark">;
    setTheme(theme: string): Promise<void>;

    // Tab paste helpers
    isSystemUrl(url: string | undefined | null): boolean;
    focusKey(tabId: number): string;
    pickTargetFrame(tabId: number): Promise<number | null>;
    getSlotKeys(): Promise<string[]>;
    slotKeysHint(keys: string[]): string;
    pasteToTab(tabId: number, template: TLTemplate, injectDelayMs?: number): Promise<void>;

    // Validation / import
    validateTemplates(raw: unknown): TLImportSummary;
    mergeImport(existing: any[], incoming: any[], conflictMode: "keepboth" | "skip" | "overwrite"): any[];
    toExportable(templates: any[], folders: TLFolder[]): any[];
    resolveImportFolders(items: any[], folders: TLFolder[], mode: "merge" | "replace", newId?: () => string): { templates: any[]; folders: TLFolder[] };

    // Debounce
    debounce<F extends (...args: any[]) => any>(fn: F, delay?: number): TLDebounced<F>;

    // Dynamic vars / fields
    CURSOR_TOKEN: string;
    DATE_FORMATS: readonly string[];
    formatDate(d: Date, fmt?: string): string;
    formatIsoDate(iso: string, fmt?: string): string;
    resolveDateDefault(def: string, now?: Date): string;
    applyDynamicVars(text: string, now?: Date): string;
    parseFields(text: string): TLField[];
    applyConditionals(template: string, values: Record<string, string>): string;
    fillTemplate(template: string, values: Record<string, string>, opts?: { escape?: boolean }): string;
    buildFieldToken(field: Partial<TLField>): string;
    isSecretName(name: unknown): boolean;

    // Backups
    ringPush<T>(arr: T[] | unknown, item: T, max: number): T[];
    pushBackup(): Promise<void>;
    getBackups(): Promise<TLBackup[]>;
    restoreBackup(ts: number): Promise<boolean>;

    // Competitor adapters
    adaptTextBlaze(parsed: unknown): Array<{ name: string; shortcut: string; body: string }> | null;
    adaptMagical(parsed: unknown): Array<{ name: string; shortcut: string; body: string }> | null;
    detectAndAdapt(parsed: unknown): { source: string; items: any[] } | null;

    // Fuzzy / search
    fuzzyScore(query: unknown, target: unknown): number;
    fuzzySearch(query: string, templates: any[], limit?: number): any[];
    searchTemplates(query: string, templates: any[]): any[];
  }

  // eslint-disable-next-line no-var
  var TL: TLApi;

  // CSS Custom Highlight API (not yet in the bundled DOM lib for all targets).
  class Highlight {
    constructor(...ranges: AbstractRange[]);
    add(r: AbstractRange): this;
    delete(r: AbstractRange): boolean;
    clear(): void;
  }
  interface HighlightRegistry { set(name: string, h: Highlight): void; delete(name: string): boolean; }
  interface Window {
    TL: TLApi;
    chrome: typeof chrome;
    __TL_CONTENT_LOADED__?: boolean;
  }
  interface WorkerGlobalScope {
    TL: TLApi;
    chrome: typeof chrome;
    __TL_CONTENT_LOADED__?: boolean;
  }
}
