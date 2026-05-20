// Code generated — DO NOT EDIT.

import type { Provider, Usage } from "./types.ts";




export interface BatchHandle {



  id: string;




  provider: Provider;




  raw?: boolean;
}




export interface File {



  id?: string;




  uri?: string;




  mimeType?: string;




  name?: string;
}




export interface ImageData {



  mimeType: string;




  bytes: Uint8Array;
}




export interface ImageResponse {



  images: ImageData[];




  text: string;




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
}




export interface MediaRef {



  mimeType: string;




  bytes: Uint8Array;
}




export interface Message {



  role: string;




  content: string;
}




export interface Response {



  text: string;




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
}
