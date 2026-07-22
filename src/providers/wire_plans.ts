// Code generated — DO NOT EDIT.


// Body plans (ADR-073 T1 config-data interpreter — VIDEO PROVING CUT).
//
// Emitted as DATA: each plan is an ordered list of field bindings a
// handwritten interpreter (slice 3) walks to build a video submit body. No
// runtime reads these tables yet. The vocabulary is CLOSED (INT-001): five
// sources (Model | Prompt | Option | Const | MediaRef), two transforms
// (None | DataUri).

/** One field of a body plan. */
export interface FieldBinding {
  path: string;
  source: string;
  optionKey: string;
  constJson: string;
  defaultJson: string;
  transform: string;
  omitIfEmpty: boolean;
}

/** A named, reusable request-body plan; several wire shapes may share one. */
export interface BodyPlan {
  label: string;
  bindings: FieldBinding[];
}

export const planVideoBedrock: BodyPlan = {
  label: "video-bedrock",
  bindings: [
    { path: "modelId", source: "Model", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "modelInput.taskType", source: "Const", optionKey: "", constJson: "\"TEXT_VIDEO\"", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "modelInput.textToVideoParams.text", source: "Prompt", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "outputDataConfig.s3OutputDataConfig.s3Uri", source: "Option", optionKey: "output_uri", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
  ],
};

export const planVideoGrok: BodyPlan = {
  label: "video-grok",
  bindings: [
    { path: "model", source: "Model", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "prompt", source: "Prompt", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "image.url", source: "MediaRef", optionKey: "", constJson: "", defaultJson: "", transform: "DataUri", omitIfEmpty: true },
  ],
};

export const planVideoModelPrompt: BodyPlan = {
  label: "video-model-prompt",
  bindings: [
    { path: "model", source: "Model", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "prompt", source: "Prompt", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
  ],
};

export const planVideoPixVerse: BodyPlan = {
  label: "video-pixverse",
  bindings: [
    { path: "model", source: "Model", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "prompt", source: "Prompt", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "duration", source: "Option", optionKey: "duration", constJson: "", defaultJson: "5", transform: "None", omitIfEmpty: false },
    { path: "quality", source: "Option", optionKey: "quality", constJson: "", defaultJson: "\"540p\"", transform: "None", omitIfEmpty: false },
    { path: "aspect_ratio", source: "Option", optionKey: "aspect_ratio", constJson: "", defaultJson: "\"16:9\"", transform: "None", omitIfEmpty: false },
  ],
};

export const planVideoQwen: BodyPlan = {
  label: "video-qwen",
  bindings: [
    { path: "input.prompt", source: "Prompt", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
    { path: "model", source: "Model", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
  ],
};

export const planVideoVeoInstances: BodyPlan = {
  label: "video-veo-instances",
  bindings: [
    { path: "instances[0].prompt", source: "Prompt", optionKey: "", constJson: "", defaultJson: "", transform: "None", omitIfEmpty: false },
  ],
};

/** Maps a video wire shape to its body plan (ADR-073). */
export const videoBodyPlans: Record<string, BodyPlan> = {
  VideoBedrock: planVideoBedrock,
  VideoGrok: planVideoGrok,
  VideoMinimax: planVideoModelPrompt,
  VideoPixVerse: planVideoPixVerse,
  VideoQwen: planVideoQwen,
  VideoTogether: planVideoModelPrompt,
  VideoVeo: planVideoVeoInstances,
  VideoVertexVeo: planVideoVeoInstances,
  VideoVidu: planVideoModelPrompt,
  VideoZhipu: planVideoModelPrompt,
};
