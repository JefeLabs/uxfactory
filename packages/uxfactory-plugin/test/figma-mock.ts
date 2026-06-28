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
  children: FakeNode[] = [];
  constructor(
    readonly type: string,
    readonly id: string,
  ) {}
  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }
  appendChild(child: FakeNode): void {
    this.children.push(child);
  }
  remove(): void {}
}

export interface FakeFigma {
  currentPage: FakeNode & { selection: FakeNode[] };
  root: { name: string };
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

  const page = Object.assign(create("PAGE"), { selection: [] as FakeNode[] });
  const posted: MainToUi[] = [];
  const ui: FakeFigma["ui"] = {
    posted,
    onmessage: null,
    postMessage(msg) {
      posted.push(msg);
    },
    resize() {},
  };

  return {
    currentPage: page,
    root: { name: "Test File" },
    fileKey: "file-key-123",
    showUI() {},
    getNodeById: (id) => registry.get(id) ?? null,
    on(type, cb) {
      if (type === "selectionchange") selectionHandlers.push(cb);
    },
    createFrame: () => create("FRAME"),
    createRectangle: () => create("RECTANGLE"),
    createText: () => create("TEXT"),
    createSection: () => create("SECTION"),
    createSticky: () => create("STICKY"),
    createConnector: () => create("CONNECTOR"),
    importComponentByKeyAsync: () => Promise.resolve({ createInstance: () => create("INSTANCE") }),
    exportAsync: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ui,
    __fireSelectionChange() {
      for (const cb of selectionHandlers) cb();
    },
    async __send(msg) {
      await ui.onmessage?.(msg);
    },
  };
}
