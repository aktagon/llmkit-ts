// Code generated — DO NOT EDIT.

import type { ImageData } from "./image.ts";
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




export interface ImageResponse {



  images: ImageData[];




  text: string;




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
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
