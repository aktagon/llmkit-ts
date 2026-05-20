// Code generated — DO NOT EDIT.

import type { Capability, Provider, Usage } from "./types.ts";




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




export interface LiveResult {



  models: ModelInfo[];




  errors: Record<string, string>;
}




export interface MediaRef {



  mimeType: string;




  bytes: Uint8Array;
}




export interface Message {



  role: string;




  content: string;
}




export interface ModelInfo {



  id: string;




  provider: Provider;




  capabilities: Capability[];




  displayName?: string;




  description?: string;




  contextWindow?: number;




  maxOutput?: number;




  created?: number;




  raw?: unknown;
}




export interface Response {



  text: string;




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
}
