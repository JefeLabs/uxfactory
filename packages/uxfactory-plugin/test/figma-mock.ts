import type { MainToUi, UiToMain } from "../src/messages.js";

/** Stand-in for real Figma's `figma.mixed` sentinel (a unique Symbol). */
export const FIGMA_MIXED: unique symbol = Symbol("figma.mixed");

/**
 * Real figma.ui.postMessage rejects unserializable payloads ("Cannot unwrap
 * symbol") — any figma.mixed leaking into a report must fail in tests too.
 */
function assertNoSymbols(value: unknown): void {
  if (typeof value === "symbol") {
    throw new Error("in postMessage: Cannot unwrap symbol");
  }
  if (Array.isArray(value)) {
    for (const v of value) assertNoSymbols(v);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) assertNoSymbols(v);
  }
}

/**
 * A fake scene node exposing only the surface `code.ts` touches.
 *
 * Note: `fills`, `strokes`, `fontName`, and `children` are already present,
 * which means `countStylesInSubtree` (selection.ts) can walk this node and
 * compute `stylesInUse` correctly in tests.
 */
export class FakeNode {
  name = "";
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  fills: unknown = undefined;
  strokes: unknown = undefined;
  strokeWeight: number | undefined = undefined;
  _cornerRadius: number | undefined = undefined;
  /**
   * Real Figma: the shorthand reads as figma.mixed (a Symbol) when the four
   * per-corner radii differ — report code must never copy it into a message.
   */
  get cornerRadius(): number | symbol | undefined {
    const corners = [
      this.topLeftRadius,
      this.topRightRadius,
      this.bottomRightRadius,
      this.bottomLeftRadius,
    ];
    const set = corners.filter((v): v is number => v !== undefined);
    if (set.length > 0) {
      return set.length === 4 && set.every((v) => v === set[0]) ? set[0] : FIGMA_MIXED;
    }
    return this._cornerRadius;
  }
  set cornerRadius(v: number | symbol | undefined) {
    if (typeof v === "number") {
      this._cornerRadius = v;
      // Real Figma's uniform shorthand writes all four corners.
      this.topLeftRadius = v;
      this.topRightRadius = v;
      this.bottomRightRadius = v;
      this.bottomLeftRadius = v;
    }
  }
  opacity: number | undefined = undefined;
  rotation: number | undefined = undefined;
  visible: boolean | undefined = undefined;
  characters: string | undefined = undefined;
  fontSize: number | undefined = undefined;
  lineHeight: unknown = undefined;
  fontName: { family: string; style: string } | undefined = undefined;
  connectorStart: unknown = undefined;
  connectorEnd: unknown = undefined;
  /** Plugin data map — populated by setPluginData(). */
  _pluginData: Map<string, string> = new Map();
  /** SVG source stashed when this node was created via createNodeFromSvg(). */
  _svg: string | undefined = undefined;
  setPluginData(key: string, value: string): void {
    this._pluginData.set(key, value);
  }
  /** Fix I3: settable clipsContent property (mirrors real Figma FrameNode). */
  clipsContent: boolean | undefined = undefined;
  /**
   * NOTE: real Figma flips primary/counterAxisSizingMode to AUTO (hug) when
   * layoutMode is enabled — this fake does NOT model that. applyAutoLayout pins
   * both axes FIXED (see code.ts); the code.test.ts assertions guard it.
   */
  layoutMode: string | undefined = undefined;
  itemSpacing: number | undefined = undefined;
  paddingTop: number | undefined = undefined;
  paddingRight: number | undefined = undefined;
  paddingBottom: number | undefined = undefined;
  paddingLeft: number | undefined = undefined;
  primaryAxisAlignItems: string | undefined = undefined;
  counterAxisAlignItems: string | undefined = undefined;
  primaryAxisSizingMode: string | undefined = undefined;
  counterAxisSizingMode: string | undefined = undefined;
  effects: unknown = undefined;
  topLeftRadius: number | undefined = undefined;
  topRightRadius: number | undefined = undefined;
  bottomRightRadius: number | undefined = undefined;
  bottomLeftRadius: number | undefined = undefined;
  _layoutSizingHorizontal: string | undefined = undefined;
  _layoutSizingVertical: string | undefined = undefined;
  /** Test probe: children length captured when layoutSizingHorizontal was set. */
  __childCountAtSizing: number | undefined = undefined;
  get layoutSizingHorizontal(): string | undefined {
    return this._layoutSizingHorizontal;
  }
  set layoutSizingHorizontal(v: string | undefined) {
    // Real Figma constraint: FILL is only legal on children of auto-layout parents.
    if (v === "FILL" && !this._parentIsAutoLayout()) {
      throw new Error(
        "in set_layoutSizingHorizontal: FILL can only be set on children of auto-layout frames",
      );
    }
    this.__childCountAtSizing = this.children.length;
    this._layoutSizingHorizontal = v;
  }
  get layoutSizingVertical(): string | undefined {
    return this._layoutSizingVertical;
  }
  set layoutSizingVertical(v: string | undefined) {
    if (v === "FILL" && !this._parentIsAutoLayout()) {
      throw new Error(
        "in set_layoutSizingVertical: FILL can only be set on children of auto-layout frames",
      );
    }
    this._layoutSizingVertical = v;
  }
  private _parentIsAutoLayout(): boolean {
    return (
      this._parent !== null &&
      this._parent.layoutMode !== undefined &&
      this._parent.layoutMode !== "NONE"
    );
  }
  children: FakeNode[] = [];
  /** Tracks which parent this node was appended to — used by remove(). */
  _parent: FakeNode | null = null;
  constructor(
    readonly type: string,
    readonly id: string,
  ) {}
  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }
  appendChild(child: FakeNode): void {
    child._parent = this;
    this.children.push(child);
  }
  /** Actually removes this node from its parent's children array. */
  remove(): void {
    if (this._parent) {
      const idx = this._parent.children.indexOf(this);
      if (idx !== -1) this._parent.children.splice(idx, 1);
      this._parent = null;
    }
  }
  /** Fake exportAsync — mirrors SceneNode.exportAsync (returns fake PNG bytes). */
  async exportAsync(_settings?: { format?: string }): Promise<Uint8Array> {
    return new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
  }
}

export interface FakeFigma {
  currentPage: FakeNode & { selection: FakeNode[] };
  root: { name: string; children: Array<FakeNode & { selection: FakeNode[] }> };
  fileKey: string;
  showUI(html: string, opts: { width: number; height: number }): void;
  getNodeById(id: string): FakeNode | null;
  on(type: string, cb: () => void): void;
  createFrame(): FakeNode;
  createRectangle(): FakeNode;
  createText(): FakeNode;
  createSection(): FakeNode;
  createSticky(): FakeNode;
  createConnector(): FakeNode;
  createComponent(): FakeNode;
  createNodeFromSvg(svg: string): FakeNode;
  createComponentCalls: number;
  createPage(): FakeNode & { selection: FakeNode[] };
  loadFontAsync(name: { family: string; style: string }): Promise<void>;
  /** Recorded keys of every loadFontAsync call, as "family/style". */
  loadFontAsyncCalls: string[];
  /** Font keys ("family/style") that loadFontAsync should reject. */
  failFontKeys: string[];
  importComponentByKeyAsync(key: string): Promise<{ createInstance(): FakeNode }>;
  exportAsync(): Promise<Uint8Array>;
  clientStorage: {
    store: Map<string, unknown>;
    getAsync(key: string): Promise<unknown>;
    setAsync(key: string, value: unknown): Promise<void>;
  };
  notify(message: string): void;
  /** All messages passed to notify(). */
  notifyCalls: string[];
  closePlugin(): void;
  /** True after closePlugin() has been called. */
  closeCalled: boolean;
  viewport: {
    center: { x: number; y: number };
    scrollAndZoomIntoViewCalls: FakeNode[][];
    scrollAndZoomIntoView(nodes: FakeNode[]): void;
  };
  ui: {
    posted: MainToUi[];
    onmessage: ((msg: UiToMain) => unknown) | null;
    postMessage(msg: MainToUi): void;
    resize(width: number, height: number): void;
  };
  /** Fire all registered selectionchange handlers. */
  __fireSelectionChange(): void;
  /** Deliver a UI→main message and await the handler's async work. */
  __send(msg: UiToMain): Promise<void>;
}

export function makeFigma(): FakeFigma {
  const registry = new Map<string, FakeNode>();
  const selectionHandlers: Array<() => void> = [];
  let counter = 0;
  const create = (type: string): FakeNode => {
    counter += 1;
    const node = new FakeNode(type, `${counter}:1`);
    registry.set(node.id, node);
    return node;
  };

  // ---- font-loading enforcement (Fix 2) ----
  const loadedFonts = new Set<string>();
  const loadFontAsyncCalls: string[] = [];
  const failFontKeys: string[] = [];

  const loadFontAsync = async (name: { family: string; style: string }): Promise<void> => {
    const key = `${name.family}/${name.style}`;
    loadFontAsyncCalls.push(key); // record BEFORE possible throw
    if (failFontKeys.includes(key)) throw new Error("font unavailable: " + key);
    loadedFonts.add(key);
  };

  /**
   * TEXT node whose `characters` setter throws unless loadFontAsync was called
   * first — mirrors real Figma's font-load requirement.
   */
  const createText = (): FakeNode => {
    const node = create("TEXT");
    // Set default fontName so code.ts can read and reassign it before setting characters.
    node.fontName = { family: "Inter", style: "Regular" };
    // Remove the class-field `characters` and replace with an enforcing accessor.
    delete (node as unknown as Record<string, unknown>).characters;
    let _chars: string | undefined = undefined;
    Object.defineProperty(node, "characters", {
      get() {
        return _chars;
      },
      set(v: string | undefined) {
        // Guard keys on the node's CURRENT fontName (may have been reassigned by code).
        const fn = node.fontName ?? { family: "Inter", style: "Regular" };
        if (v !== undefined && !loadedFonts.has(`${fn.family}/${fn.style}`)) {
          throw new Error(
            `figma.loadFontAsync must be called before setting TextNode.characters ` +
              `(font: ${fn.family} ${fn.style})`,
          );
        }
        _chars = v;
      },
      configurable: true,
      enumerable: true,
    });
    return node;
  };

  /**
   * STICKY node with a `text` TextSublayer — real Figma's StickyNode exposes
   * text via `.text.characters`, not `.characters` directly.
   */
  const createSticky = (): FakeNode => {
    const node = create("STICKY");
    (node as unknown as Record<string, unknown>).text = {
      characters: undefined as string | undefined,
    };
    return node;
  };

  /**
   * CONNECTOR node with a `text` TextSublayer — real Figma's ConnectorNode
   * exposes its label via `.text.characters`.
   */
  const createConnector = (): FakeNode => {
    const node = create("CONNECTOR");
    (node as unknown as Record<string, unknown>).text = {
      characters: undefined as string | undefined,
    };
    return node;
  };

  // ---- component + instance (Task 6) ----
  const cloneNode = (src: FakeNode): FakeNode => {
    const copy = new FakeNode(src.type === "COMPONENT" ? "INSTANCE" : src.type, `${(counter += 1)}:1`);
    copy.name = src.name;
    copy.x = src.x;
    copy.y = src.y;
    copy.width = src.width;
    copy.height = src.height;
    copy.fills = src.fills;
    copy.characters = src.characters;
    copy.visible = src.visible;
    for (const c of src.children) copy.appendChild(cloneNode(c));
    return copy;
  };
  let createComponentCalls = 0;
  const createComponent = (): FakeNode => {
    createComponentCalls += 1;
    const node = create("COMPONENT");
    (node as unknown as Record<string, unknown>).createInstance = () => cloneNode(node);
    return node;
  };

  // ---- page management (Fix 3) ----
  const initialPage = Object.assign(create("PAGE"), { selection: [] as FakeNode[] });
  const pages: Array<FakeNode & { selection: FakeNode[] }> = [initialPage];
  // Mutable slot so code.ts can reassign fig.currentPage.
  let _currentPage: FakeNode & { selection: FakeNode[] } = initialPage;

  const createPage = (): FakeNode & { selection: FakeNode[] } => {
    const p = Object.assign(create("PAGE"), { selection: [] as FakeNode[] });
    pages.push(p);
    return p;
  };

  // ---- clientStorage ----
  const clientStorageStore = new Map<string, unknown>();
  const clientStorage: FakeFigma["clientStorage"] = {
    store: clientStorageStore,
    async getAsync(key: string): Promise<unknown> {
      return clientStorageStore.get(key);
    },
    async setAsync(key: string, value: unknown): Promise<void> {
      clientStorageStore.set(key, value);
    },
  };

  // ---- notify / closePlugin ----
  const notifyCalls: string[] = [];
  let closeCalled = false;

  // ---- viewport ----
  const scrollAndZoomIntoViewCalls: FakeNode[][] = [];
  const viewport = {
    center: { x: 0, y: 0 },
    scrollAndZoomIntoViewCalls,
    scrollAndZoomIntoView(nodes: FakeNode[]) {
      scrollAndZoomIntoViewCalls.push([...nodes]);
    },
  };

  // ---- ui bus ----
  const posted: MainToUi[] = [];
  const ui: FakeFigma["ui"] = {
    posted,
    onmessage: null,
    postMessage(msg: MainToUi) {
      assertNoSymbols(msg);
      posted.push(msg);
    },
    resize() {},
  };

  // Build the object with explicit parameter types so that contextual typing works
  // even without the `as FakeFigma` shorthand on methods.
  const result: FakeFigma = {
    get currentPage(): FakeNode & { selection: FakeNode[] } {
      return _currentPage;
    },
    set currentPage(p: FakeNode & { selection: FakeNode[] }) {
      _currentPage = p;
    },
    root: { name: "Test File", children: pages },
    fileKey: "file-key-123",
    showUI() {},
    getNodeById(id: string) {
      return registry.get(id) ?? null;
    },
    on(type: string, cb: () => void) {
      if (type === "selectionchange") selectionHandlers.push(cb);
    },
    createFrame: () => create("FRAME"),
    createRectangle: () => create("RECTANGLE"),
    createText,
    createSection: () => create("SECTION"),
    createSticky,
    createConnector,
    createComponent,
    createNodeFromSvg(svg: string): FakeNode {
      const node = create("FRAME");
      node._svg = svg;
      return node;
    },
    get createComponentCalls() {
      return createComponentCalls;
    },
    createPage,
    loadFontAsync,
    loadFontAsyncCalls,
    failFontKeys,
    importComponentByKeyAsync: () => Promise.resolve({ createInstance: () => create("INSTANCE") }),
    exportAsync: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    clientStorage,
    notify(message: string): void {
      notifyCalls.push(message);
    },
    get notifyCalls() {
      return notifyCalls;
    },
    closePlugin(): void {
      closeCalled = true;
    },
    get closeCalled() {
      return closeCalled;
    },
    viewport,
    ui,
    __fireSelectionChange() {
      for (const cb of selectionHandlers) cb();
    },
    async __send(msg: UiToMain) {
      await ui.onmessage?.(msg);
    },
  };

  return result;
}
