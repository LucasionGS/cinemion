/// <reference lib="deno.worker" />
import Path from "node:path";
import { toFileUrl } from "@std/path";
import ClipTokenizer from "./ClipTokenizer.ts";

/**
 * Runs the image model for picture recognition, away from the server's main thread: one picture takes a good part
 * of a second, and the server keeps streaming meanwhile. The model and its runtime are downloaded files (see
 * `Recognition`), so they're loaded from disk here instead of being part of Cinemion.
 */

interface OrtTensor {
  data: Float32Array;
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}

interface Ort {
  env: { wasm: { numThreads: number; wasmBinary?: Uint8Array } };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array): Promise<OrtSession> };
}

export type Request =
  | { id: number; type: "init"; dir: string }
  | { id: number; type: "image"; pixels: Uint8Array }
  | { id: number; type: "text"; text: string };

export type Reply = { id: number; vector?: Float32Array; error?: string };

const SIZE = 224;
// How CLIP expects colours: per channel, around these averages
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

let ort: Ort | null = null;
let vision: OrtSession | null = null;
let text: OrtSession | null = null;
let tokenizer: ClipTokenizer | null = null;

function normalize(values: Float32Array) {
  let sum = 0;
  for (const v of values) sum += v * v;
  const length = Math.sqrt(sum) || 1;
  return values.map((v) => v / length);
}

async function init(dir: string) {
  ort = await import(toFileUrl(Path.join(dir, "ort.bundle.min.mjs")).href) as Ort;
  // Threads would need their own workers, which can't load the runtime from a downloaded file
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = await Deno.readFile(Path.join(dir, "ort-wasm-simd-threaded.wasm"));
  vision = await ort.InferenceSession.create(await Deno.readFile(Path.join(dir, "vision_model_quantized.onnx")));
  text = await ort.InferenceSession.create(await Deno.readFile(Path.join(dir, "text_model_quantized.onnx")));
  tokenizer = new ClipTokenizer(JSON.parse(await Deno.readTextFile(Path.join(dir, "tokenizer.json"))));
}

async function embedImage(pixels: Uint8Array) {
  if (!ort || !vision) throw new Error("The picture recognition isn't loaded.");
  const area = SIZE * SIZE;
  const data = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) data[c * area + i] = (pixels[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  const result = await vision.run({ pixel_values: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]) });
  return normalize(result.image_embeds.data);
}

async function embedText(input: string) {
  if (!ort || !text || !tokenizer) throw new Error("The picture recognition isn't loaded.");
  const ids = tokenizer.encode(input);
  const result = await text.run({ input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) });
  return normalize(result.text_embeds.data);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "init") {
      await init(request.dir);
      self.postMessage({ id: request.id } satisfies Reply);
    }
    else if (request.type === "image") self.postMessage({ id: request.id, vector: await embedImage(request.pixels) } satisfies Reply);
    else self.postMessage({ id: request.id, vector: await embedText(request.text) } satisfies Reply);
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) } satisfies Reply);
  }
};
