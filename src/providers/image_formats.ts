// Code generated — DO NOT EDIT.


/** ImageSignaturePart is the bytes that must sit at offset. */
export interface ImageSignaturePart {
  readonly offset: number;
  readonly bytes: readonly number[];
}

/**
 * ImageFormatDef is one image format: its media type, other names callers
 * state for it, its file extension and its byte signatures. A format
 * matches when every part of any one signature matches. A format with no
 * signature is typed by a handwritten text check.
 */
export interface ImageFormatDef {
  readonly mediaType: string;
  readonly aliases: readonly string[];
  readonly extension: string;
  readonly signatures: readonly (readonly ImageSignaturePart[])[];
}

/** IMAGE_FORMATS is the image format table, in media type order. */
export const IMAGE_FORMATS: readonly ImageFormatDef[] = [
  {
    mediaType: "image/avif",
    aliases: [],
    extension: ".avif",
    signatures: [
      // ftyp, major brand avif
      [
        { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
        { offset: 8, bytes: [0x61, 0x76, 0x69, 0x66] },
      ],
      // ftyp, major brand avis
      [
        { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
        { offset: 8, bytes: [0x61, 0x76, 0x69, 0x73] },
      ],
    ],
  },
  {
    mediaType: "image/gif",
    aliases: [],
    extension: ".gif",
    signatures: [
      // GIF87a
      [
        { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
      ],
      // GIF89a
      [
        { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
      ],
    ],
  },
  {
    mediaType: "image/heic",
    aliases: [],
    extension: ".heic",
    signatures: [
      // ftyp, major brand heic
      [
        { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
        { offset: 8, bytes: [0x68, 0x65, 0x69, 0x63] },
      ],
      // ftyp, major brand heim
      [
        { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
        { offset: 8, bytes: [0x68, 0x65, 0x69, 0x6d] },
      ],
      // ftyp, major brand heis
      [
        { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
        { offset: 8, bytes: [0x68, 0x65, 0x69, 0x73] },
      ],
      // ftyp, major brand heix
      [
        { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
        { offset: 8, bytes: [0x68, 0x65, 0x69, 0x78] },
      ],
    ],
  },
  {
    mediaType: "image/jpeg",
    aliases: ["image/jpg"],
    extension: ".jpg",
    signatures: [
      // SOI and the next marker
      [
        { offset: 0, bytes: [0xff, 0xd8, 0xff] },
      ],
    ],
  },
  {
    mediaType: "image/png",
    aliases: [],
    extension: ".png",
    signatures: [
      // PNG signature
      [
        { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
      ],
    ],
  },
  {
    mediaType: "image/svg+xml",
    aliases: [],
    extension: ".svg",
    signatures: [],
  },
  {
    mediaType: "image/webp",
    aliases: [],
    extension: ".webp",
    signatures: [
      // RIFF container, WEBP
      [
        { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
        { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
      ],
    ],
  },
];
