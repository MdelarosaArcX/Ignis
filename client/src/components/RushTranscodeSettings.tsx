import React, { useEffect, useMemo, useRef, useState } from "react";
import logo from "../assets/logo.png";
import axios from "axios";
import type { FormData, Preset } from "../types/transcode";
const serverIP = import.meta.env.VITE_SERVER_IP;
const serverPort = import.meta.env.VITE_SERVER_PORT;
import {
  FRAME_RATE_OPTIONS,
  AUDIO_CODEC_OPTIONS,
  VIDEO_CODEC_OPTIONS,
  RESOLUTION_OPTIONS,
  FILETYPE_OPTIONS,
} from "../types/options";
import HotfolderSettings from "../components/HotfolderSettings"; // ✅ Add this import

interface Props {
  file: File | null;
  setFile: React.Dispatch<React.SetStateAction<File | null>>;
  uploading: boolean;
  onSubmit: () => void;
  formData: FormData | null;
  handleChange: (field: keyof FormData, value: string) => void;
  presets: Preset[];
  isValid: boolean;
  setValid: (value: boolean) => void;
  setMetadatapopup: (value: string) => void;
  activeTab: string;
  selectedData: any;
  setIsLargeFile: (value: boolean) => void;
}

const TranscodePanel: React.FC<Props> = ({
  file,
  setFile,
  onSubmit,
  formData,
  handleChange,
  presets,
  isValid,
  setValid,
  setMetadatapopup,
  activeTab,
  selectedData,
  setIsLargeFile,
}) => {
  const dropRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [metadata, setMetadata] = useState<{
    filename: string;
    videoCodec: string;
    audioCodec: string;
    frameRate: string | number | null;
    frameRateVal: string;
    resolution: string | null;
    size: string;
    metaData: string;
    outputMetaData: string;
    outputFolder: string;
    duration: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [hotfolder, setHotfolder] = useState<number>(0);
  const [isEditHotFolder, setIsEditHotfolder] = useState<boolean>(false);

  const initialSettings = {
    "1": {
      watchFolder: "C:\\Sample",
      outputFolder: "C:\\Sample",
      errorFolder: "C:\\Sample",
      watchdogRate: "0",
      transcodeSetting: {
        name: "",
        outputFormat: "",
        frameRate: "",
        videoCodec: "",
        vbrcbr: "",
        quality: "",
        audioCodec: "",
        compressionMode: "",
        resolution: "",
        processor: "",
        key: "",
        outputFileName: "",
      },
    },
    "2": {
      watchFolder: "C:\\Sample",
      outputFolder: "C:\\Sample",
      errorFolder: "C:\\Sample",
      watchdogRate: "0",
      transcodeSetting: {
        name: "",
        outputFormat: "",
        frameRate: "",
        videoCodec: "",
        vbrcbr: "",
        quality: "",
        audioCodec: "",
        compressionMode: "",
        resolution: "",
        processor: "",
        key: "",
        outputFileName: "",
      },
    },
    "3": {
      watchFolder: "C:\\Sample",
      outputFolder: "C:\\Sample",
      errorFolder: "C:\\Sample",
      watchdogRate: "0",
      transcodeSetting: {
        name: "",
        outputFormat: "",
        frameRate: "",
        videoCodec: "",
        vbrcbr: "",
        quality: "",
        audioCodec: "",
        compressionMode: "",
        resolution: "",
        processor: "",
        key: "",
        outputFileName: "",
      },
    },
  };

  const [ignisConfig, setIgnisConfig] = useState<any>(null);

  useEffect(() => {
    axios
      .get(`http://${serverIP}:${serverPort}/api/config`)
      .then((res) => setIgnisConfig(res.data))
      .catch((err) => console.error("Failed to load ignisConfig:", err));
  }, []);

  const processorLimits = useMemo(() => {
    if (!ignisConfig) return { allowCPU: true, allowGPU: true };

    const mode = ignisConfig.systemLoadMode;
    const limits = ignisConfig.limits[`mode${mode}`];

    return {
      allowCPU: limits.allowCPU,
      allowGPU: limits.allowGPU,
    };
  }, [ignisConfig]);

  useEffect(() => {
    cancelTranscode();
    setHotfolder(0);
  }, [activeTab]);
  const handleDrop = async (e: React.DragEvent) => {
    cancelTranscode();
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    setFile(droppedFile);

    // ⏳ Load metadata locally
    const form = new FormData();
    form.append("video", droppedFile);

    try {
      setLoading(true);
      setProgress(0);

      const response = await axios.post(
        `http://${serverIP}:${serverPort}/api/metadata`,
        form,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e) => {
            const percent = Math.round((e.loaded * 100) / (e.total ?? 1));
            setProgress(percent);
            if (percent === 100) setValid(true);
          },
        }
      );

      handleChange("resolution", response.data.resolution);
      handleChange("key", response.data.key);
      setMetadata(response.data);

      // 🧠 Mark large file in state, but don't queue yet
      if (droppedFile.size > 10 * 1024 * 1024 * 1024) {
        setIsLargeFile(true);
      } else {
        setIsLargeFile(false);
      }
    } catch (err) {
      console.error("Failed to fetch metadata:", err);
    } finally {
      setLoading(false);
    }
  };

  const d = new Date();
  const formatted =
    d.getDate().toString().padStart(2, "0") +
    d.toLocaleString("en-US", { month: "short" }) +
    d.getFullYear();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current) dropRef.current.classList.add("border-blue-500");
  };

  const cancelTranscode = () => {
    setFile(null);
    setMetadata(null);
    setValid(false);
    handleChange("name", "cancel");

    setHotfolder(0);
    setIsEditHotfolder(false);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current) dropRef.current.classList.remove("border-blue-500");
  };

  const editTranscodeSetting = (
    hotfolder: any,
    id: number,
    isEdit: boolean
  ) => {
    setHotfolder(id);
    setIsEditHotfolder(isEdit);

    const t = hotfolder.transcodeSetting || {};
    console.log("t");
    console.log(t);
    handleChange("name", t.name || "");
    // ✅ Apply transcode settings
    handleChange("fileType", t.outputFormat || "");
    handleChange("videoCodec", t.videoCodec || "");
    handleChange("audioCodec", t.audioCodec || "");
    handleChange("frameRate", t.frameRate || "");
    handleChange("resolution", t.resolution || "");
    handleChange("vbrcbr", t.vbrcbr || "");
    handleChange("quality", t.quality || "");

    handleChange("outputFileName", t.outputFileName || "");

    handleChange("processor", t.processor || "");
    // console.log(formData);

    // ✅ Display watchFolder + outputFolder in the metadata preview
    setMetadata({
      filename: hotfolder.watchFolder || "",
      videoCodec: t.videoCodec || "",
      audioCodec: t.audioCodec || "",
      frameRate: t.frameRate ? `${t.frameRate} fps` : "",
      frameRateVal: t.frameRate || "",
      resolution: t.resolution || "",
      size: "",
      metaData: "",
      outputMetaData: "",
      duration: "",
      outputFolder: hotfolder.outputFolder || "",
    } as any);

    // console.log("Loaded transcode settings + folder paths", metadata);
  };

  useEffect(() => {
    if (!file) {
      setMetadata(null);
    }
  }, [file]);

  useEffect(() => {
    setMetadata({
      filename: selectedData?.input?.fileName,
      videoCodec: selectedData?.input?.videoCodec,
      audioCodec: selectedData?.input?.audioCodec,
      frameRate: selectedData?.input?.frameRate
        ? selectedData?.input?.frameRate
        : "",
      frameRateVal: selectedData?.input?.frameRate,
      resolution: selectedData?.input?.resolution,
      size: selectedData?.input?.size,
      metaData: selectedData?.input?.report,
      outputMetaData: selectedData?.output?.report,
      duration: selectedData?.input?.duration,
      outputFolder: "",
    });
  }, [selectedData]);

  useEffect(() => {
    const handleGlobalKeyPress = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        setTimeout(() => {
          onSubmit();
        }, 0);
      }
    };

    document.addEventListener("keydown", handleGlobalKeyPress);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyPress);
    };
  }, [onSubmit, file]);

  // ✅ Auto-set frameRate if metadata has a value
  useEffect(() => {
    if (metadata?.frameRateVal) {
      const frameRateStr = metadata.frameRateVal.toString();
      if (!formData?.frameRate) {
        handleChange("frameRate", frameRateStr);
      }
    }
  }, [metadata?.frameRateVal]);

  // ✅ Filter codecs dynamically based on selected file type
  const filteredVideoCodecOptions = useMemo(() => {
    return VIDEO_CODEC_OPTIONS.filter((opt) => {
      // ❌ Disable H.265 for AVI
      if (formData?.fileType === "avi" && opt.value === "libx265") return false;
      return true;
    });
  }, [formData?.fileType]);

  // ✅ Filter file types if you also want to block AVI when H.265 selected
  const filteredFileTypeOptions = useMemo(() => {
    return FILETYPE_OPTIONS.filter((opt) => {
      // ❌ Disable AVI for H.265
      if (formData?.videoCodec === "libx265" && opt.value === "avi")
        return false;
      return true;
    });
  }, [formData?.videoCodec]);

  // ✅ Reset incompatible codec automatically when switching file type
  useEffect(() => {
    if (formData?.fileType === "avi" && formData?.videoCodec === "libx265") {
      handleChange("videoCodec", "");
    }
  }, [formData?.fileType]);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 w-full ${
        activeTab === "settings" ? "h-[483px]" : "h-[285px]"
      } text-white items-center justify-center p-8`}
    >
      {/* Hidden file input for folder selection */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={() => {}} // Handled in handleFolderSelect
      />

      <div
        className="rush-transcode-settings"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        ref={dropRef}
      >
        {file || metadata?.filename ? (
          <div className="float-right">
            <button
              className="rounded-full pr-5 pl-5 text-sm bg-gray-400 text-black pt-1 pb-1 mt-3 mr-3 cursor-pointer"
              onClick={cancelTranscode}
            >
              Cancel
            </button>
          </div>
        ) : (
          ""
        )}
        <br />

        {activeTab === "settings" && (
          <HotfolderSettings
            hotfolder={hotfolder}
            editTranscodeSetting={editTranscodeSetting}
            initialSettings={initialSettings}
            formData={formData} // 👈 pass current transcode form
          />
        )}

        {activeTab === "settings" ? (
          <hr className="mt-4 mb-4 ml-40 mr-40 text-[#707D86]" />
        ) : (
          ""
        )}

        <div
          className={`flex w-full items-center pb-5 items-start ${
            activeTab === "settings" && !hotfolder
              ? "text-gray-500"
              : "text-white"
          }`}
        >
          <div className="flex-1 text-center">
            <div className="text-left pl-10 text-white">
              <p>
                <span className="border-b-2 text-[15px] border-white">
                  Transcode Settings
                </span>
              </p>
            </div>
            <br />
            <div className="grid gird-flow-row-dense grid-cols-4 text-[13px] gap-1">
              <div className="text-right">Processor :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white`}
                    value={formData?.processor || ""}
                    onChange={(e) => handleChange("processor", e.target.value)}
                  >
                    <option value="">-- Select Processor --</option>

                    <option value="gpu" disabled={!processorLimits.allowGPU}>
                      GPU{" "}
                      {processorLimits.allowGPU ? "" : "(Disabled by system)"}
                    </option>

                    <option value="cpu" disabled={!processorLimits.allowCPU}>
                      CPU{" "}
                      {processorLimits.allowCPU ? "" : "(Disabled by system)"}
                    </option>
                  </select>
                )}
              </div>
              <div className="text-right">Preset :</div>

              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.name || ""}
                    onChange={(e) => handleChange("name", e.target.value)}
                  >
                    <option value="">-- Select Preset --</option>
                    {Array.isArray(presets) &&
                      presets.map((preset, idx) => (
                        <option key={idx} value={preset.name.value}>
                          {preset.name.displayValue}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="text-right">Comp. Quality :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.quality || ""}
                    onChange={(e) => handleChange("quality", e.target.value)}
                  >
                    <option value="highest">Highest</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                )}
              </div>

              <div className="text-right">
                {" "}
                {activeTab === "settings" ? "" : "Task Name :"}
              </div>

              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings"
                  ? ""
                  : `Rush Transcode 1 - ${formatted}`}
              </div>
              <div className="text-right">VBR/CBR :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.vbrcbr || ""}
                    onChange={(e) => handleChange("vbrcbr", e.target.value)}
                  >
                    <option value="">Auto</option>
                    <option value="cbr">CBR</option>
                    <option value="vbr">VBR</option>
                  </select>
                )}
              </div>

              <div className="text-right">
                {" "}
                {activeTab === "settings" ? "" : "Media Duration :"}
              </div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings"
                  ? ""
                  : `${
                      metadata?.duration
                        ? metadata?.duration + " minutes"
                        : "N/A"
                    }`}
              </div>
            </div>
          </div>
          <div className="h-36 w-px relative top-5 bg-[#707D86]"></div>
          {/* Middle / Right columns unchanged (omitted here to keep file short) */}
          <div className="flex-1 text-center">
            <div className="flex items-center text-center justify-center text-[15px]">
              <span className="border-b-2 text-white  border-white">Input</span>
              {metadata?.metaData && (
                <svg
                  onClick={() => setMetadatapopup(metadata.metaData)}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  className="size-6 ml-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                  />
                </svg>
              )}
            </div>
            <br />
            <div className="grid grid-flow-row-dense grid-cols-4 text-[13px] gap-1">
              <div className="text-right">File Name/Loc :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : loading ? (
                  <div className="flex items-center">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-200"
                      style={{ width: `${progress}%` }}
                    ></div>
                    <div>{progress}%</div>
                  </div>
                ) : (
                  <span className="text-white inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse">
                    {metadata?.filename
                      ? metadata?.filename
                      : file?.name || "No file"}
                  </span>
                )}

                {/* {activeTab === "settings" && hotfolder ? (
                  <span className="text-white inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse">{metadata?.filename || ""}</span>
                ) : loading ? (
                  <div className="flex items-center">
                    <div className="bg-green-500 h-2 rounded-full transition-all duration-200" style={{ width: `${progress}%` }}></div>
                    <div>{progress}%</div>
                  </div>
                ) : (
                  <span className="text-white">{metadata?.filename ? metadata?.filename : file?.name || "No file"}</span>
                )} */}
              </div>

              <div className="text-right">Video Codec :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && hotfolder ? (
                  "N/A"
                ) : (
                  <span className="text-white">
                    {metadata?.videoCodec ? metadata?.videoCodec : "N/A"}
                  </span>
                )}
              </div>

              <div className="text-right">Audio Codec :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && hotfolder ? (
                  "N/A"
                ) : (
                  <span className="text-white">
                    {metadata?.audioCodec ? metadata?.audioCodec : "N/A"}
                  </span>
                )}
              </div>

              <div className="text-right">Frame Rate :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && hotfolder ? (
                  "N/A"
                ) : (
                  <span className="text-white">
                    {metadata?.frameRate ? metadata?.frameRate : "N/A"}
                  </span>
                )}
              </div>

              <div className="text-right">Resolution :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && hotfolder ? (
                  "N/A"
                ) : (
                  <span className="text-white">
                    {metadata?.resolution ? metadata?.resolution : "N/A"}
                  </span>
                )}
              </div>

              <div className="text-right">File size :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && hotfolder ? (
                  "N/A"
                ) : (
                  <span className="text-white">
                    {metadata?.size ? metadata?.size : "N/A"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="h-36 w-px relative top-5 bg-[#707D86]"></div>
          <div className="flex-1 text-center">
            <div className="flex items-center text-center justify-center text-[15px]">
              <span className="border-b-2 text-white  border-white">
                Output
              </span>
              {metadata?.outputMetaData && (
                <svg
                  onClick={() => setMetadatapopup(metadata.outputMetaData)}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  className="size-6 ml-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                  />
                </svg>
              )}
            </div>
            <br />
            <div className="grid grid-flow-row-dense grid-cols-4 text-[13px] gap-1 ">
              <div className="text-right">File Name/Loc :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : hotfolder ? (
                  <span className="inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse">
                    {metadata?.outputFolder}
                  </span>
                ) : (
                  <input
                    type="text"
                    value={formData?.outputFileName || ""}
                    className="ignisSelect"
                    onChange={(e) =>
                      handleChange("outputFileName", e.target.value)
                    }
                  />
                )}
              </div>

              <div className="text-right">File Type :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.fileType || ""}
                    onChange={(e) => handleChange("fileType", e.target.value)}
                  >
                    <option value="">-- Select File Type --</option>
                    {filteredFileTypeOptions.map((opt, idx) => (
                      <option key={idx} value={opt.value}>
                        {opt.displayValue}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="text-right">Video Codec :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.videoCodec || ""}
                    onChange={(e) => handleChange("videoCodec", e.target.value)}
                  >
                    <option value="">-- Select Video Codec --</option>
                    {filteredVideoCodecOptions.map((opt, idx) => (
                      <option key={idx} value={opt.value}>
                        {opt.displayValue}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="text-right">Audio Codec :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.audioCodec || ""}
                    onChange={(e) => handleChange("audioCodec", e.target.value)}
                  >
                    <option value="">-- Select Audio Codec --</option>
                    {AUDIO_CODEC_OPTIONS.map((opt, idx) => (
                      <option key={idx} value={opt.value}>
                        {opt.displayValue}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="text-right">Frame Rate :</div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" && !hotfolder ? (
                  ""
                ) : (
                  // <select
                  //   className="ignisSelect"
                  //   value={formData?.frameRate || ""}
                  //   onChange={(e) => handleChange("frameRate", e.target.value)}
                  // >
                  //   <option value=""></option>
                  //   {FRAME_RATE_OPTIONS.map((opt, idx) => (
                  //     <option key={idx} value={opt.value}>
                  //       {opt.displayValue}
                  //     </option>
                  //   ))}
                  // </select>

                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.frameRate || ""}
                    onChange={(e) => handleChange("frameRate", e.target.value)}
                  >
                    <option value="">-- Select Frame Rate --</option>

                    {FRAME_RATE_OPTIONS.map((opt, idx) => (
                      <option key={idx} value={opt.value.toString()}>
                        {opt.displayValue}
                      </option>
                    ))}

                    {/* dynamically add metadata fps if missing */}
                    {metadata?.frameRateVal &&
                      !FRAME_RATE_OPTIONS.some(
                        (opt) =>
                          opt.value.toString() ===
                          metadata.frameRateVal.toString()
                      ) && (
                        <option value={metadata.frameRateVal.toString()}>
                          {metadata.frameRateVal} fps
                        </option>
                      )}
                  </select>
                )}
              </div>
              <div className="text-right">
                {" "}
                {activeTab === "settings" ? "" : "Resolution :"}
              </div>
              <div className="col-span-3 pl-2 text-left">
                {activeTab === "settings" ? (
                  ""
                ) : (
                  <select
                    disabled={!isEditHotFolder && activeTab === "settings"}
                    className={`ignisSelect disabled:opacity-100 disabled:bg-[#363a3e] disabled:text-white disabled:cursor-default disabled:pointer-events-none ${isEditHotFolder}`}
                    value={formData?.resolution || ""}
                    onChange={(e) => handleChange("resolution", e.target.value)}
                  >
                    <option value="">-- Select Resolution --</option>
                    {RESOLUTION_OPTIONS.map((opt, idx) => (
                      <option key={idx} value={opt.value}>
                        {opt.displayValue}
                      </option>
                    ))}
                    {metadata?.resolution &&
                      !RESOLUTION_OPTIONS.some(
                        (opt) => opt.value === metadata.resolution
                      ) && (
                        <option value={metadata.resolution}>
                          {metadata.resolution}
                        </option>
                      )}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
        {activeTab === "settings" ? (
          ""
        ) : (
          <div
            className={`absolute right-14 ${
              activeTab === "settings" && !hotfolder ? "top-10/12" : "top-51"
            } `}
          >
            <div
              className={`rounded-full p-2 border-2 cursor-pointer transform transition active:scale-95 hover:scale-105 
                  duration-150 ease-in-out shadow-md
                   ${
                     !isValid
                       ? "border-[#BABCBB]"
                       : formData?.frameRate &&
                         formData?.fileType &&
                         formData?.videoCodec &&
                         formData?.audioCodec &&
                         formData?.processor &&
                         formData?.vbrcbr
                       ? "border-[#05FF00]"
                       : "border-[#FF0000]"
                   }`}
            >
              <img onClick={onSubmit} src={logo} width={30} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TranscodePanel;
