/**
 * Text-to-image generation against Google's Nano Banana.
 *
 * Run: GOOGLE_API_KEY=... bun run examples/image.ts
 */
import { google, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? google(process.env.GOOGLE_API_KEY ?? "k");
  const img = await client.image
    .model("gemini-3.1-flash-image-preview")
    .aspectRatio("16:9")
    .imageSize("2K")
    .generate("A nano banana dish, studio lighting");

  const first = img.images[0];
  if (!first) throw new Error("no image returned");
  await Bun.write("out.png", first.bytes);
  console.log(`wrote out.png (${first.bytes.length} bytes)`);
}

if (import.meta.main) {
  await main();
}
