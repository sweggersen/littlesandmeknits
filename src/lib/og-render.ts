import satori, { init as initSatori } from 'satori/standalone';
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
// @ts-expect-error — Cloudflare's Vite plugin resolves .wasm imports to a
// pre-compiled WebAssembly.Module at build time. Runtime WASM compilation
// is blocked by the Workers embedder, so static imports are required.
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-expect-error — same as above; satori bundles its yoga layout engine
// as a separate WASM file that we have to initialize ourselves on Workers.
import yogaWasmModule from 'satori/yoga.wasm';

class StageError extends Error {
  stage: string;
  constructor(stage: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(causeMsg);
    this.stage = stage;
    if (cause instanceof Error && cause.stack) this.stack = cause.stack;
  }
}

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await initResvg(resvgWasmModule);
      } catch (err) {
        throw new StageError('init-resvg', err);
      }
      try {
        await initSatori(yogaWasmModule);
      } catch (err) {
        throw new StageError('init-yoga', err);
      }
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
    /** Optional rasterization width — defaults to `width` (1:1). Use a smaller
     * value to save CPU on Cloudflare Workers; resvg fitTo will scale the
     * vector SVG down to this pixel width. */
    renderWidth?: number;
    fonts: Array<{ name: string; data: ArrayBuffer; weight: number; style?: 'normal' | 'italic' }>;
  }
): Promise<Uint8Array> {
  await ensureInit();
  let svg: string;
  try {
    // satori type expects React.ReactNode; our object tree is structurally compatible.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svg = await satori(tree as any, {
      width: opts.width,
      height: opts.height,
      fonts: opts.fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style ?? 'normal' })),
    });
  } catch (err) {
    throw new StageError('satori', err);
  }
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: opts.renderWidth ?? opts.width },
    });
    return resvg.render().asPng();
  } catch (err) {
    throw new StageError('resvg', err);
  }
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
