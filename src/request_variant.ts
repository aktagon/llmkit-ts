// Request-variant selection (ADR-096) — mirror of go/request_variant.go.

import type { CarriedInput, RequestVariant } from "./providers/image_gen.ts";
import { ValidationError } from "./errors.ts";

/**
 * selectRequestVariant picks the config's wire request by the inputs the
 * request carries (ADR-096): imageCarries when it holds at least one image
 * part, else TextOnly. The capability names what its image parts are:
 * WithReferenceImages for image, WithSeedFrame for video. A config with no
 * variant for those inputs cannot send the request, so the caller gets a
 * ValidationError on "parts".
 */
export function selectRequestVariant(
  provider: string,
  variants: RequestVariant[],
  imageCount: number,
  imageCarries: CarriedInput,
): RequestVariant {
  const carries: CarriedInput = imageCount > 0 ? imageCarries : "TextOnly";
  const variant = variants.find((v) => v.carries === carries);
  if (!variant) {
    throw new ValidationError("parts", `${provider} has no ${carries} request`);
  }
  return variant;
}
