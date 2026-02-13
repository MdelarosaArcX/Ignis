import { useEffect, useRef, useState } from "react";
import axios from "axios";
import ignisLogo from "./assets/ignis.png";
// import Settings from "./pages/Settings";
import Report from "./pages/Report";
import Dashboard, { type FileEntry } from "./pages/Dashboard";
import RushTranscodeSettings from "./components/RushTranscodeSettings";
import type { FormData, Preset } from "./types/transcode";
const serverIP = import.meta.env.VITE_SERVER_IP;
const serverPort = import.meta.env.VITE_SERVER_PORT;
import "./App.css";
import Modal from "./components/Modal";

function formatDate() {
  const now = new Date(Date.now());
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function App() {
  const [formData, setFormData] = useState<FormData | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [isValid, setValid] = useState<boolean>(false);

  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [metadatapopup, setMetadatapopup] = useState<string>("");

  const [selectedData, setSelectedData] = useState<any>("");

  const [uploading, setUploading] = useState(false);
  const [, setIsLargeFile] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "settings" | "report"
  >("dashboard");

  // Keep a ref to the latest formData so event handlers (like global key handlers)
  // can access the freshest data synchronously.
  const formDataRef = useRef<FormData | null>(formData);
  useEffect(() => {
    if (file?.name) {
      const outputName = `${file.name.replace(/\.[^/.]+$/, "")}`;

      if (formData?.outputFileName) {
        return;
      }
      setFormData((prev): FormData | null => {
        if (!prev) return null; // handle the null case
        return {
          ...prev,
          outputFileName: outputName,
        };
      });
    }
  }, [file, formData]);

  useEffect(() => {
    refreshFiles();
    clearFormData();
    cleanServer();
  }, [activeTab]);
  const clearFormData = () => {
    setFormData({
      name: "",
      fileType: "",
      frameRate: "",
      videoCodec: "",
      vbrcbr: "cbr",
      quality: "medium",
      audioCodec: "",
      compressionMode: "",
      resolution: "",
      processor: "",
      key: "",
      outputFileName: "",
    });
  };

  useEffect(() => {
    fetchFiles();

    clearFormData();
  }, []);
  useEffect(() => {
    // console.log('selectedData');
    // console.log(selectedData);
    setFormData({
      fileType: selectedData?.settings?.outputFormat,
      frameRate: selectedData?.settings?.frameRate,
      videoCodec: selectedData?.settings?.videoCodec,
      vbrcbr: "cbr",
      quality: selectedData?.settings?.quality
        ? selectedData?.settings?.quality
        : "medium",
      audioCodec: selectedData?.settings?.audioCodec,
      compressionMode: "",
      resolution: selectedData?.settings?.resolution,
      processor: selectedData?.settings?.processor,
      key: selectedData?.settings?.key,
      name: selectedData?.settings?.presetName
        ? selectedData?.settings?.presetName.toUpperCase()
        : "",
      outputFileName: selectedData ? selectedData?.output?.fileName : "",
    });
  }, [selectedData]);

  useEffect(() => {
    // use full URL to your backend if needed
    axios
      .get<Preset[]>(`http://${serverIP}:${serverPort}/api/presets`)
      .then((res) => {
        if (Array.isArray(res.data)) {
          // normalize presets
          setPresets(res.data);
          // setPresets(res.data);
          if (res.data.length > 0) {
            // setFormData(res.data[0]);
            // setSelectedPreset(res.data[0].name);
            // formDataRef.current = res.data[0];
          }
        } else {
          console.error("Presets endpoint did not return an array:", res.data);
        }
      })
      .catch((err) => {
        console.error("Failed to load presets:", err);
      });
  }, []);

  const fetchFiles = async () => {
    const res = await axios.get<FileEntry[]>(
      `http://${serverIP}:${serverPort}/api/files`
    );
    setFiles(res.data);
  };

  const refreshFiles = fetchFiles;

  const cleanServer = async () => {
    await axios.get(`http://${serverIP}:${serverPort}/api/cleanup`);
  };

  // handleChange now accepts (field, value). When field === "name" we try to
  // apply the entire preset.
  const handleChange = (field: keyof FormData, value: string) => {
    if (field === "name" && value === "cancel") {
      clearFormData();
      setSelectedData("");
      return;
    }

    if (field === "name") {
      if (value === "") {
        setFormData((prev): FormData | null => {
          if (!prev) return null; // handle the null case
          return {
            ...prev,
            name: "",
          };
        });
        return;
      }

      // user picked a preset
      const preset = presets.find((p) => p.name.value === value);
      if (preset) {
        console.log("preset");
        console.log(preset);
        console.log("formData");
        console.log(formData);
        const normalized: FormData = {
          name: preset.name.value,
          fileType: preset.fileType.value,
          frameRate: preset.frameRate.value,
          videoCodec: preset.videoCodec.value,
          vbrcbr: preset.vbrcbr.value,
          quality: preset.quality.value,
          audioCodec: preset.audioCodec.value,
          compressionMode: preset.compressionMode.value,
          resolution: formData?.resolution,
          processor: formData?.processor ? formData?.processor : "",
          key: formData?.key,
          outputFileName: formData?.outputFileName
            ? formData?.outputFileName
            : "",
        };
        console.log("normalized");
        console.log(normalized);

        setFormData(normalized);
        formDataRef.current = normalized;
      }

      console.log("value");
      console.log(value);
      // console.log('formData');
      // console.log(formData);
      return;
    }

    if (field === "outputFileName") {
      // console.log(value);
      // console.log(files.find((file) => file.output.fileName === value));
    }
    // if(!value) {
    //   setFormData(null);
    // }
    // normal single-field update
    setFormData((prev) => {
      // console.log(prev);
      const updated = { ...(prev as FormData), [field]: value };
      formDataRef.current = updated;
      return updated;
    });
  };

  const onSubmit = async () => {
    if (!file) return;
    setValid(true);
    setUploading(true);

    const current = formDataRef.current;
    if (
      !current?.frameRate ||
      !current.fileType ||
      !current.videoCodec ||
      !current.audioCodec ||
      !current.processor
    ) {
      setUploading(false);
      setValid(false);
      return;
    }

    // Build form
    const form = {
      frameRate: current.frameRate.toLowerCase(),
      outputFormat: current.fileType.toLowerCase(),
      videoCodec: current.videoCodec.toLowerCase(),
      audioCodec: current.audioCodec.toLowerCase(),
      vbrcbr: current.vbrcbr.toLowerCase(),
      processor: current.processor.toLowerCase(),
      quality: current.quality.toLowerCase(),
      fileType: current.fileType.toLowerCase(),
      resolution: current.resolution ? current.resolution.toLowerCase() : "",
      key: current.key ? current.key.toLowerCase() : "",
      presetName: current.name ? current.name.toLowerCase() : "",
      outputFileName: current.outputFileName ? current.outputFileName : "",
    };

    // --- ⬇️ STEP 1: Create temporary placeholder BEFORE axios ---
    const tempId = `temp-${Date.now()}`;
    const placeholder = {
      id: tempId,
      progress: 0,
      uploadedAt: new Date().toISOString(),
      input: {
        fileName: file.name,
        url: "",
        metaData: "",
        report: "",
        frameRate: current.frameRate,
        resolution: current.resolution || "",
        duration: "",
        size: "",
        videoCodec: current.videoCodec,
      },
      output: {
        fileName: current.outputFileName,
        url: "",
        metaData: "",
        metaDataUrl: "",
        report: "",
        videoCodec: "",
      },
      startTime: formatDate(),
      completedTime: "",
      elapsed: "",
      ratio: "Pending...",
    };
    // const isExistingName = files.filter((file) => file.output.fileName === `${placeholder.output.fileName}.${current.fileType === 'mpegts' ? 'ts' : current.fileType}`);
    // console.log('files');
    //  console.log(files);
    //   console.log('placeholder');
    //  console.log(placeholder);
    // if(isExistingName.length !== 0) {
    //   placeholder.output.fileName = `${placeholder.output.fileName} (${isExistingName.length}).${current.fileType === 'mpegts' ? 'ts' : current.fileType}`;
    //   form.outputFileName = placeholder.output.fileName;
    //   console.log('sa23mple23');
    // }else{
    //   console.log('sample23');
    //   form.outputFileName = `${placeholder.output.fileName}.${current.fileType === 'mpegts' ? 'ts' : current.fileType}`;
    // }

    const ext = current.fileType === "mpegts" ? "ts" : current.fileType;
    const baseName = placeholder.output.fileName;

    // Match:
    // large.mp4
    // large (2).mp4
    const regex = new RegExp(`^${baseName}(?: \\((\\d+)\\))?\\.${ext}$`);

    const matches = files
      .map((f) => f.output.fileName)
      .map((name) => {
        const match = name.match(regex);
        return match ? Number(match[1] || 1) : null;
      })
      .filter((n) => n !== null);

    if (matches.length === 0) {
      // No conflict
      form.outputFileName = `${baseName}.${ext}`;
    } else {
      const nextIndex = Math.max(...matches) + 1;
      form.outputFileName = `${baseName} (${nextIndex}).${ext}`;
    }

    placeholder.output.fileName = form.outputFileName;

    console.log(form);
    setFiles((prev) => [...prev, placeholder]);
    // ✅ Only clear when conversion actually succeeds
    setFile(null);
    clearFormData();
    setSelectedData("");
    try {
      // const { data } = await axios.post<FileEntry>(
      //   `http://${serverIP}:${serverPort}/api/conver`",
      //   form,
      //   { headers: { "Content-Type": "multipart/form-data" } }
      // );

      const { data } = await axios.post(
        `http://${serverIP}:${serverPort}/api/convert`,
        form
      );

      await axios.post(`http://${serverIP}:${serverPort}/api/enqueue`, {
        key: data.id,
      });
      setFiles((prev) =>
        prev.map((f) => (f.id === tempId ? { ...data, progress: 0 } : f))
      );

      // ✅ SUCCESS → replace placeholder, then clear file/form
      setFiles((prev) =>
        prev.map((f) => (f.id === tempId ? { ...data, progress: 0 } : f))
      );
    } catch (error) {
      console.error("Conversion failed:", error);

      // remove the placeholder from file list
      setFiles((prev) => prev.filter((f) => f.id !== tempId));

      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 409) {
          alert(
            error.response.data.error ||
              "Output file already exists! Please rename and try again."
          );
        } else {
          alert(
            `Conversion failed: ${error.response.data?.error || error.message}`
          );
        }
      } else {
        alert("An unexpected error occurred during conversion.");
      }

      // 🚫 Do NOT clear formData or file here — user can just rename and retry
    } finally {
      // ✅ Always stop loading spinner, but keep data on error
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen text-white pb-[341px]">
      {/* Top Navigation */}
      <div className="float-left pl-9 pt-8">
        <img onClick={onSubmit} src={ignisLogo} width={70} />
      </div>
      <nav className="flex p-4 gap-4 justify-end items-center">
        <button
          className={`px-4 py-2 ${
            activeTab === "dashboard"
              ? "border-b-2 border-white text-white"
              : "text-gray-500 border-none"
          }`}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={`px-4 py-2 ${
            activeTab === "settings"
              ? "border-b-2 border-white text-white"
              : "text-gray-500 border-none"
          }`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
        <button
          className={`px-4 py-2 ${
            activeTab === "report"
              ? "border-b-2 border-white text-white"
              : "text-gray-500 border-none"
          }`}
          onClick={() => setActiveTab("report")}
        >
          Report
        </button>
        <div>User 734</div>
      </nav>

      <div className="pl-8 pr-8 pt-5 pb-5">
        <hr />
      </div>

      <main className="p-4">
        {(activeTab === "dashboard" || activeTab === "settings") && (
          <Dashboard
            files={files}
            refreshFiles={refreshFiles}
            setSelectedData={setSelectedData}
            selectedData={selectedData}
          />
        )}
        {/* {activeTab === "settings" && <Settings />} */}
        {activeTab === "report" && <Report />}
      </main>

      {/* Only render panel once we have formData to avoid undefined checks */}
      <RushTranscodeSettings
        file={file}
        setFile={setFile}
        uploading={uploading}
        onSubmit={onSubmit}
        formData={formData}
        handleChange={handleChange}
        presets={presets}
        isValid={isValid}
        setValid={setValid}
        setMetadatapopup={setMetadatapopup}
        activeTab={activeTab}
        selectedData={selectedData}
        setIsLargeFile={setIsLargeFile}
      />

      <Modal
        isOpen={metadatapopup !== "" ? true : false}
        onClose={() => setMetadatapopup("")}
      >
        <pre className="text-gray-600">{metadatapopup}</pre>
      </Modal>
    </div>
  );
}

export default App;
