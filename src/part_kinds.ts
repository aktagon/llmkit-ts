// Part-kind pre-flight check (ADR-100 MSG-011). Mirror of go/part_kinds.go.

import { ValidationError } from "./errors.ts";
import { ACCEPTED_PART_KINDS, PART_KINDS, type Part } from "./structs.ts";

/**
 * checkPartKinds throws a ValidationError, before any HTTP call, for a part
 * whose kind the capability does not accept, naming the kind (ADR-100
 * MSG-011). A part must carry exactly one Part key; a value built outside the
 * type system can carry none or several. capability is the capability label
 * that keys the generated ACCEPTED_PART_KINDS table, e.g. "image_generation".
 * field names the parts list in the error, e.g. "messages[2].parts".
 */
export function checkPartKinds(
  capability: string,
  parts: Part[],
  field = "parts",
): void {
  const accepted = ACCEPTED_PART_KINDS[capability] ?? [];
  parts.forEach((part, i) => {
    const kind = partKindOf(part, `${field}[${i}]`);
    if (!accepted.includes(kind)) {
      throw new ValidationError(
        `${field}[${i}]`,
        `${capability.replaceAll("_", " ")} does not accept ${kind} parts`,
      );
    }
  });
}

/** PartKey is a key of one Part variant, e.g. "text" or "toolCall". */
export type PartKey = Part extends infer P ? (P extends unknown ? keyof P : never) : never;

/**
 * hasPart reports whether part sets key: its value is not undefined, null or
 * "". It is the one definition of a set Part key, as in Go, where a nil
 * pointer or an empty string is an unset variant. partKindOf and every
 * encoder read a part by it, so they pick the same variant (HANDOFF-111).
 */
export function hasPart<K extends PartKey>(part: Part, key: K): part is Extract<Part, Record<K, unknown>> {
  const value = (part as Record<string, unknown>)[key];
  return value !== undefined && value !== null && value !== "";
}

/**
 * partKindOf returns the one kind a part sets (hasPart), or throws a
 * ValidationError on field for a part that sets none or more than one: an
 * empty text, lyrics or audio_url part sets none (owner decision 2,
 * HANDOFF-105 F11; HANDOFF-111). It is the one check of a part's shape:
 * checkPartKinds runs it for chat and every other capability, and
 * saveHistory runs it, so a request and a Save reject the same part with the
 * same error (F11, F12).
 */
export function partKindOf(part: Part, field: string): string {
  const kinds = (Object.keys(PART_KINDS) as PartKey[]).flatMap((key) =>
    hasPart(part, key) ? [PART_KINDS[key]!] : [],
  );
  const [kind, ...rest] = kinds;
  if (kind === undefined) {
    throw new ValidationError(field, "empty part");
  }
  if (rest.length > 0) {
    throw new ValidationError(field, `sets ${kinds.join(" and ")}; a part sets exactly one kind`);
  }
  return kind;
}
