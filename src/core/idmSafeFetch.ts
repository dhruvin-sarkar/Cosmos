/**
 * Download managers (IDM and similar) hijack browser requests whose URL ends in ".bin" and pop up a "save file" dialog,
 * which breaks data loading on machines that have one installed. The dev/preview servers (vite.config.ts) and the
 * production build expose every public *.bin file under the same path with a ".cbin" extension instead, and this module
 * rewrites requests to match. Code keeps referring to the real ".bin" names.
 */
const BIN_URL = /\.bin(?=[?#]|$)/i;

/** "data/stars/stars.bin?v=2" -> "data/stars/stars.cbin?v=2"; other URLs are returned unchanged. */
export function idmSafeUrl(url: string): string {
  return BIN_URL.test(url) ? url.replace(BIN_URL, '.cbin') : url;
}

let installed = false;

/** Wraps globalThis.fetch once so every *.bin request (domains, data runtime, three.js loaders) goes out as *.cbin. */
export function installIdmSafeFetch(): void {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === 'string') return nativeFetch(idmSafeUrl(input), init);
    if (input instanceof URL) return nativeFetch(idmSafeUrl(input.href), init);
    if (BIN_URL.test(input.url)) return nativeFetch(new Request(idmSafeUrl(input.url), input), init);
    return nativeFetch(input, init);
  };
}
