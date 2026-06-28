declare const __html__: string;
const api = figma as unknown as {
  showUI(html: string, opts: { width: number; height: number }): void;
};
api.showUI(__html__, { width: 540, height: 220 });
