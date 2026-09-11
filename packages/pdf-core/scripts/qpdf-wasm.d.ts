declare module '@jspawn/qpdf-wasm/qpdf.mjs' {
  const init: (options?: Record<string, unknown>) => Promise<unknown>;
  export default init;
}
