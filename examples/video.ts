








import { grok, Client } from "../src/builders/index.ts";

export async function main(c?: Client): Promise<void> {
  const client = c ?? grok(process.env.XAI_API_KEY ?? "k");
  // #region video
  const handle = await client.video
    .model("grok-imagine-video")
    .submit(
      "a slow cinematic drone shot flying over snow-capped alpine peaks at golden hour",
    );

  const r = await handle.wait();

  const v = r.videos[0];
  if (!v) throw new Error("no video returned");
  console.log(
    `done: url=${v.url} duration=${v.durationSeconds}s mime=${v.mimeType}`,
  );
  // #endregion
}

if (import.meta.main) {
  await main();
}
