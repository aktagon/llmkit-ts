/**
 * Text-to-music generation against Vertex Lyria 2.
 *
 * Run: GOOGLE_APPLICATION_CREDENTIALS=... bun run examples/music.ts
 *
 * lyria-002 is instrumental-only — no `.lyrics()`.
 */
import { vertex, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? vertex(process.env.VERTEX_ACCESS_TOKEN ?? "k");
  const r = await client.music
    .model("lyria-002")
    .generate("a calm instrumental, warm piano and soft strings");

  const first = r.audio[0];
  if (!first) throw new Error("no audio returned");
  await Bun.write("out.wav", first.bytes);
  console.log(`wrote out.wav (${first.bytes.length} bytes)`);
}

if (import.meta.main) {
  await main();
}
