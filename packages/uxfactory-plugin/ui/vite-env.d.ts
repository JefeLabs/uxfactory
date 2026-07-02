/// <reference types="vite/client" />

// Side-effect CSS imports from package subpaths (e.g. @mdxeditor/editor/style.css)
// trip TS2882 under noUncheckedSideEffectImports; vite handles them at build time.
declare module "*.css";
