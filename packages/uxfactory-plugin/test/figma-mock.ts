import type { MainToUi, UiToMain } from "../src/messages.js";

/** A fake scene node exposing only the surface `code.ts` touches. */
export class FakeNode {
  name = "";
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  fills: unknown = undefined;
  strokes: unknown = undefined;
  strokeWeight: number | undefined = undefined;
  cornerRadius: number | undefined = undefined;
  opacity: number | undefined = undefined;
  rotation: number | undefined = undefined;
  visible: boolean | undefined = undefined;
  characters: string | undefined = undefined;
  connectorStart: unknown = undefined;
  connectorEnd: unknown = undefined;
  /** Fix I3: settable clipsContent property (mirrors real Figma FrameNode). */
  clipsContent: boolean | undefined = undefined;
  layoutMode: string | undefined = undefined;
  itemSpacing: number | undefined = undefined;
  paddingTop: number | undefined = undefined;
  paddingRight: number | undefined = undefined;
  paddingBottom: number | undefined = undefined;
  paddingLeft: number | undefined = undefined;
  primaryAxisAlignItems: string | undefined = undefined;
  counterAxisAlignItems: string | undefined = undefined;
  _layoutSizingHorizontal: string | undefined = undefined;
  _layoutSizingVertical: string | undefined = undefined;
  /** Test probe: children length captured when layoutSizingHorizontal was set. */
  __childCountAtSizing: number | undefined = undefined;
  get layoutSizingHorizontal(): string | undefined {
    return this._layoutSizingHorizontal;
  }
  set layoutSizingHorizontal(v: string | undefined) {
    this.__childCountAtSizing = this.children.length;
    this._layoutSizingHorizontal = v;
  }
  get layoutSizingVertical(): string | undefined {
    return this._layoutSizingVertical;
  }
  set layoutSizingVertical(v: string | undefined) {
    this._layoutSizingVertical = v;
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
  createPage(): FakeNode & { selection: FakeNode[] };
  loadFontAsync(name: { family: string; style: string }): Promise<void>;
  /** Recorded keys of every loadFontAsync call, as "family/style". */
  loadFontAsyncCalls: string[];
  importComponentByKeyAsync(key: string): Promise<{ createInstance(): FakeNode }>;
  exportAsync(): Promise<Uint8Array>;
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

  const loadFontAsync = async (name: { family: string; style: string }): Promise<void> => {
    const key = `${name.family}/${name.style}`;
    loadedFonts.add(key);
    loadFontAsyncCalls.push(key);
  };

  /**
   * TEXT node whose `characters` setter throws unless loadFontAsync was called
   * first — mirrors real Figma's font-load requirement.
   */
  const createText = (): FakeNode => {
    const node = create("TEXT");
    const fontName = { family: "Inter", style: "Regular" };
    // Expose fontName so code.ts can pass it to loadFontAsync.
    (node as unknown as Record<string, unknown>).fontName = fontName;
    // Remove the class-field `characters` and replace with an enforcing accessor.
    delete (node as unknown as Record<string, unknown>).characters;
    let _chars: string | undefined = undefined;
    Object.defineProperty(node, "characters", {
      get() {
        return _chars;
      },
      set(v: string | undefined) {
        if (v !== undefined && !loadedFonts.has(`${fontName.family}/${fontName.style}`)) {
          throw new Error(
            `figma.loadFontAsync must be called before setting TextNode.characters ` +
              `(font: ${fontName.family} ${fontName.style})`,
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

  // ---- ui bus ----
  const posted: MainToUi[] = [];
  const ui: FakeFigma["ui"] = {
    posted,
    onmessage: null,
    postMessage(msg: MainToUi) {
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
    createPage,
    loadFontAsync,
    loadFontAsyncCalls,
    importComponentByKeyAsync: () => Promise.resolve({ createInstance: () => create("INSTANCE") }),
    exportAsync: () => Promise.resolve(new Uint8Array([1, 2, 3])),
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
