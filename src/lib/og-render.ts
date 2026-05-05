import satori, { init as initSatori } from 'satori/standalone';
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
// @ts-expect-error — Cloudflare's Vite plugin resolves .wasm imports to a
// pre-compiled WebAssembly.Module at build time. Runtime WASM compilation
// is blocked by the Workers embedder, so static imports are required.
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-expect-error — same as above; satori bundles its yoga layout engine
// as a separate WASM file that we have to initialize ourselves on Workers.
import yogaWasmModule from 'satori/yoga.wasm';

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await Promise.all([initResvg(resvgWasmModule), initSatori(yogaWasmModule)]);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export type SatoriNode =
  | { type: string; props: { style?: Record<string, unknown>; children?: SatoriNode | SatoriNode[]; [key: string]: unknown } }
  | string
  | number;

export async function renderPng(
  tree: SatoriNode,
  opts: {
    width: number;
    height: number;
    fonts: Array<{ name: string; data: ArrayBuffer; weight: number; style?: 'normal' | 'italic' }>;
  }
): Promise<Uint8Array> {
  await ensureInit();
  // satori type expects React.ReactNode; our object tree is structurally compatible.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(tree as any, {
    width: opts.width,
    height: opts.height,
    fonts: opts.fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style ?? 'normal' })),
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: opts.width } });
  return resvg.render().asPng();
}

export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const mime = res.headers.get('content-type') ?? 'image/jpeg';
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}
