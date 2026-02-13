export interface Option<T = string> {
  value: T;
  displayName: string;
}

// options.ts
export const FRAME_RATE_OPTIONS = [
  { value: "24", displayValue: "24 fps" },
  { value: "25", displayValue: "25 fps" },
  { value: "30", displayValue: "30 fps" },
  { value: "50", displayValue: "50 fps" },
  { value: "60", displayValue: "60 fps" },
];

export const AUDIO_CODEC_OPTIONS = [
  { value: "aac", displayValue: "AAC Advance Audio Codec" },
  { value: "libmp3lame", displayValue: "MP3" },
];

export const VIDEO_CODEC_OPTIONS = [
  { value: "libx264", displayValue: "H.264 / AVC" },
  { value: "libx265", displayValue: "H.265 / HEVC" },
];

export const RESOLUTION_OPTIONS = [
  { value: "640x480", displayValue: "640x480" },
  { value: "1280x720", displayValue: "1280x720" },
  { value: "1920x1080", displayValue: "1920x1080" },
];


export const FILETYPE_OPTIONS = [
  { value: "mpegts", displayValue: "MPEG TS" },
  { value: "mov", displayValue: "MOV" },
  { value: "mp4", displayValue: "MP4" },
  { value: "avi", displayValue: "AVI" },
];

