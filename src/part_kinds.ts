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

/**
 * partKindOf returns the one kind a part sets, or throws a ValidationError on
 * field for a part that sets none or more than one. checkPartKinds uses it.
 */
export function partKindOf(part: Part, field: string): string {
  const kinds = Object.keys(part).flatMap((key) => PART_KINDS[key] ?? []);
  const [kind, ...rest] = kinds;
  if (kind === undefined) {
    throw new ValidationError(field, "empty part");
  }
  if (rest.length > 0) {
    throw new ValidationError(field, `sets ${kinds.join(" and ")}; a part sets exactly one kind`);
  }
  return kind;
}

/**
 * checkChatPart is the one check of a chat part's shape, run by the request
 * side (checkTurnParts) and by saveHistory, so both reject the same part with
 * the same error (HANDOFF-105 F11): a part that sets no kind or two, and a
 * text part with no text, which sets no kind in Go (owner decision 2).
 */
export function checkChatPart(part: Part, field: string): void {
  partKindOf(part, field);
  if ("text" in part && part.text === "") {
    throw new ValidationError(field, "empty part");
  }
}

/** partKind is the variant name of a part checkPartKinds accepted. */
export function partKind(part: Part): string {
  const key = Object.keys(part).find((k) => k in PART_KINDS);
  return key === undefined ? "" : PART_KINDS[key]!;
}
