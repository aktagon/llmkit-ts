// Request-variant selection (ADR-096) — mirror of go/request_variant.go.

import type { CarriedInput, RequestVariant } from "./providers/image_gen.ts";
import { ValidationError } from "./errors.ts";

/**
 * selectRequestVariant picks the config's wire request whose carried inputs
 * equal `carries`, in any order (ADR-096). A first-and-last-frame request
 * carries two inputs. A config with no variant for those inputs cannot send
 * the request, so the caller gets a ValidationError on "parts".
 */
export function selectRequestVariant(
  provider: string,
  variants: RequestVariant[],
  carries: CarriedInput[],
): RequestVariant {
  const variant = variants.find(
    (v) =>
      v.carries.length === carries.length &&
      v.carries.every((c) => carries.includes(c)),
  );
  if (!variant) {
    throw new ValidationError(
      "parts",
      `${provider} has no ${carriedInputWords(carries)} request`,
    );
  }
  return variant;
}

/**
 * The carried inputs in the words an error message uses; the constant names
 * are internal (ADR-104 PUB-005).
 */
const CARRIED_INPUT_NAMES: Record<CarriedInput, string> = {
  TextOnly: "text-only",
  WithReferenceImages: "reference image",
  WithSeedFrame: "seed frame",
  WithLastFrame: "last frame",
};

/** carriedInputWords names carries in words, such as "seed frame and last frame". */
function carriedInputWords(carries: CarriedInput[]): string {
  return carries.map((c) => CARRIED_INPUT_NAMES[c]).join(" and ");
}

/**
 * partsCarry is the carried input of a request with `imageCount` image
 * parts: `imageInput` when it holds at least one, else TextOnly. The
 * capability names what its image parts are: WithReferenceImages for image,
 * WithSeedFrame for video.
 */
export function partsCarry(
  imageCount: number,
  imageInput: CarriedInput,
): CarriedInput[] {
  return imageCount > 0 ? [imageInput] : ["TextOnly"];
}
