// Normalized form data (used for submission)
export interface FormData {
  name: string;
  fileType: string;
  frameRate: string;
  videoCodec: string;
  vbrcbr: string;
  quality: string;
  audioCodec: string;
  compressionMode: string;
  resolution: string | null | undefined;
  processor: string;
  key: string | null | undefined;
  outputFileName: string;
}

// Preset.json field (raw from backend)
export interface PresetField {
  value: string;
  displayValue: string;
}

// Full preset object (raw from backend)
export interface Preset {
  name: PresetField;
  fileType: PresetField;
  frameRate: PresetField;
  videoCodec: PresetField;
  vbrcbr: PresetField;
  quality: PresetField;
  audioCodec: PresetField;
  compressionMode: PresetField;
  resolution: PresetField;
}
