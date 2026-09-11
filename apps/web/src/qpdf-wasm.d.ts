declare module '@jspawn/qpdf-wasm/qpdf.mjs' {
  const init: (options?: Record<string, unknown>) => Promise<unknown>;
  export default init;
}
declare module '@jspawn/qpdf-wasm/qpdf.wasm?url' {
  const url: string;
  export default url;
}
declare module '@jspawn/qpdf-wasm/qpdf.js?raw' {
  const source: string;
  export default source;
}
