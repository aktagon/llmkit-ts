// Code generated — DO NOT EDIT.

import type { Capability, Provider, Usage } from "./types.ts";




export interface AudioData {



  mimeType: string;




  bytes: Uint8Array;
}




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




  errors: Record<string, ProviderError>;
}




export interface MediaRef {



  mimeType: string;




  bytes: Uint8Array;
}




export interface Message {



  role: string;




  content: string;




  toolCalls: ToolCall[];




  toolResult: ToolResult | null;
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




export interface MusicResponse {



  audio: AudioData[];




  text: string;




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
}




export interface ProviderError {



  kind: string;




  message: string;
}




export interface Response {



  text: string;




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
}




export interface ToolCall {



  id: string;




  name: string;




  input?: unknown;
}




export interface ToolResult {



  toolUseId: string;




  content: string;
}




export interface VideoData {



  mimeType: string;




  url?: string;




  bytes?: Uint8Array;




  durationSeconds?: number;
}




export interface VideoHandle {



  id: string;




  provider: Provider;




  raw?: boolean;




  model?: string;
}




export interface VideoResponse {



  videos: VideoData[];




  usage: Usage;




  finishReason?: string;




  finishMessage?: string;




  raw?: unknown;
}
