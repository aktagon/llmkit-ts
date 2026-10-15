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
      `${provider} has no ${carries.join("+")} request`,
    );
  }
  return variant;
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
