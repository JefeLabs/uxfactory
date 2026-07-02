/// <reference types="vite/client" />

// Side-effect CSS imports from package subpaths trip TS2882; vite handles them
// at build time. The wildcard alone didn't satisfy the checker here, so declare
// the exact specifier too.
declare module "*.css" {}
declare module "@mdxeditor/editor/style.css" {}
