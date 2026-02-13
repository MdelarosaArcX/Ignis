import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
const serverIP = import.meta.env.VITE_SERVER_IP;
const serverPort = import.meta.env.VITE_SERVER_PORT;
export interface FileEntry {
  progress?: number;
  id: string;
  uploadedAt: string;
  status?: string;
  priority?: number;
  input: {
    fileName: string;
    url: string;
    metaData: string;
    report: string;
    frameRate: string;
    resolution: string;
    duration: string;
    size: string;
    videoCodec: string;
  };
  output: {
    fileName: string;
    url: string;
    metaData: string;
    metaDataUrl: string;
    report: string;
    videoCodec: string;
  };
  startTime: string;
  completedTime: string;
  elapsed: string;
  ratio: string;
}

interface Props {
  files: FileEntry[];
  refreshFiles: () => void;
  setSelectedData: (value: any) => void;
  selectedData: any;
}

const FileTable: React.FC<Props> = ({
  files,
  setSelectedData,
  selectedData,
}) => {
  const [fileList, setFileList] = useState<FileEntry[]>(files);
  const sourcesRef = useRef<Record<string, EventSource>>({});
  const [updatingPriority, setUpdatingPriority] = useState<string | null>(null);

  // Sync prop files
  useEffect(() => {
    setFileList((prev) => {
      const merged = [...files];
      return merged.map((f) => {
        const existing = prev.find((p) => p.id === f.id);
        return existing
          ? { ...f, progress: existing.progress ?? f.progress }
          : f;
      });
    });
  }, [files]);

  // SSE progress polling
  useEffect(() => {
    fileList.forEach((file) => {
      const id = file.id;
      if (!id || id.startsWith("temp-") || file.progress === 100) return;
      if (sourcesRef.current[id]) return;

      const es = new EventSource(`http://${serverIP}:${serverPort}/api/progress/${id}`);

      es.onmessage = (e) => {
        if (e.data === "STOPPED") {
          es.close();
          delete sourcesRef.current[id];
          setFileList((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress: 0 } : f))
          );
          refreshFiles();
          return;
        }

        const pct = parseFloat(e.data);
        setFileList((prev) =>
          prev.map((f) => (f.id === id ? { ...f, progress: pct } : f))
        );

        if (pct >= 100) {
          es.close();
          delete sourcesRef.current[id];
          refreshFiles();
        }
      };

      es.onerror = () => {
        es.close();
        delete sourcesRef.current[id];
      };

      sourcesRef.current[id] = es;
    });
  }, [fileList]);

  useEffect(() => {
    const es = new EventSource(`http://${serverIP}:${serverPort}/api/file-updates`);

    es.onmessage = (e) => {
      // console.log("📡 File update event:", e.data);
      refreshFiles(); // ✅ instantly reload file list when new file detected
    };

    es.onerror = () => {
      console.warn("SSE connection lost, retrying in 2s...");
      es.close();
      setTimeout(() => window.location.reload(), 2000);
    };

    return () => es.close();
  }, []);

  useEffect(() => {
    return () => {
      Object.values(sourcesRef.current).forEach((es) => es.close());
    };
  }, []);

  const refreshFiles = async () => {
    try {
      const res = await fetch(`http://${serverIP}:${serverPort}/api/files`);
      const freshFiles: FileEntry[] = await res.json();
      setFileList(freshFiles);
    } catch (err) {
      console.error("Failed to refresh file list", err);
    }
  };

  const removeData = async (file: FileEntry) => {
    try {
      axios
        .post(`http://${serverIP}:${serverPort}/api/removeData`, {
          id: file.id,
        })
        .then(() => {
          refreshFiles();
          // console.log("Data has been removed:", file.id);
        })
        .catch((err) => {
          console.error("Failed to remove data:", err);
        })
        .finally(() => {
          // setUpdatingPriority(null);
          // light refresh after short delay (debounced)
          // setTimeout(refreshFiles, 800);
        });
    } catch (err) {
      console.error("Failed to removed:", err);
      // setUpdatingPriority(null);
    }
  };

  const clearAllCompleted = async () => {
    try {
      axios
        .post(`http://${serverIP}:${serverPort}/api/removeAllCompleted`, {})
        .then(() => {
          refreshFiles();
        })
        .catch((err) => {
          console.error("Failed to remove data:", err);
        })
        .finally(() => {
          // setUpdatingPriority(null);
          // light refresh after short delay (debounced)
          // setTimeout(refreshFiles, 800);
        });
    } catch (err) {
      console.error("Failed to removed:", err);
      // setUpdatingPriority(null);
    }
  };
  const setData = (file: FileEntry) => {
    setSelectedData(file);
  };

  // Change priority
  const changePriority = async (file: FileEntry, delta: number) => {
    const newPriority = Math.min(5, Math.max(1, (file.priority || 3) + delta));

    // ✅ Instant visual update (optimistic)
    setFileList((prev) =>
      prev.map((f) =>
        f.id === file.id
          ? { ...f, priority: newPriority }
          : f
      )
    );

    setUpdatingPriority(file.id);

    try {
      // Send API request in background
      axios
        .post(`http://${serverIP}:${serverPort}/api/priority/${file.id}`, {
          priority: newPriority,
        })
        .then(() => {
          // console.log("✅ Priority updated on server:", file.output.fileName);
        })
        .catch((err) => {
          console.error("Failed to update priority:", err);
        })
        .finally(() => {
          setUpdatingPriority(null);
          // light refresh after short delay (debounced)
          setTimeout(refreshFiles, 800);
        });
    } catch (err) {
      console.error("Priority update error:", err);
      setUpdatingPriority(null);
    }
  };

  // Stop conversion
  const stopConversion = async (file: FileEntry) => {
    try {
      const id = file.id;
      if (!id) return;

      setFileList((prev) =>
        prev.map((f) => (f.id === id ? { ...f, progress: 0 } : f))
      );

      if (sourcesRef.current[id]) {
        sourcesRef.current[id].close();
        delete sourcesRef.current[id];
      }

      await fetch(`http://${serverIP}:${serverPort}/api/stop/${id}`, { method: "POST" });
      await refreshFiles();
      setSelectedData(null);
    } catch (err) {
      console.error("Failed to stop conversion", err);
    }
  };

  // Helpers
  const getPriorityColor = (priority?: number) => {
    // if (!priority) return "bg-gray-400";
    if (priority === 1) return "bg-[#FF0000]"; // red highest
    if (priority === 2) return "bg-[#FFB800]"; // orange
    if (priority === 3) return "bg-[#2CB4BD]"; // blue
    if (priority === 0) return "bg-[#05FF00]"; // green
    return "bg-blue-400"; // lowest
  };

  //   const getStatusColor = (status?: string) => {
  //     switch (status) {
  //       case "processing":
  //         return "text-blue-400";
  //       case "completed":
  //         return "text-green-400";
  //       case "queued":
  //         return "text-yellow-400";
  //       case "error":
  //         return "text-red-500";
  //       default:
  //         return "text-gray-400";
  //     }
  //   };

  return (
    <div className="p-4">
      {fileList.find((list) => list?.status === "completed") ? (
        <div className="float-right pb-2">
          <button
            className={`px-4 py-2 border-2 cursor-pointer rounded transform transition active:scale-95 hover:scale-105 
                  duration-150 ease-in-out shadow-md border-[#263440] text-white bg-[#263440]`}
            onClick={() => clearAllCompleted()}
          >
            Clear All
          </button>
        </div>
      ) : (
        ""
      )}

      <table className="w-full table-auto border-collapse text-sm main-table border-none">
        <thead>
          <tr>
            <th className="p-2">#</th>
            <th className="p-2">Name</th>
            {/* <th className="p-2">Status</th> */}
            <th className="p-2">Priority</th>
            <th className="p-2">Progress / Ratio</th>
            <th className="p-2">Start</th>
            <th className="p-2">Complete</th>
            <th className="p-2">Output filename</th>
            <th className="p-2">I/P Codec</th>
            <th className="p-2">O/P Codec</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {fileList
            // .sort((a, b) => (a.priority || 3) - (b.priority || 3))
            .map((file, idx) => {
              const percent = file.progress ?? 0;
              const priority = file.priority ?? 3;

              return (
                <tr
                  key={file.id}
                  className={`odd:bg-[#0F1921] even:bg-[#1C3343] ${
                    selectedData?.id === file.id ? "!bg-[#00577d]" : ""
                  }`}
                >
                  <td className="p-2">{idx + 1}</td>
                  <td className="p-2">{file?.input?.fileName}</td>
                  {/* <td className={`p-2 ${getStatusColor(file.status)}`}>
                    {file.status || "-"}
                  </td> */}

                  {/* Priority with left/right arrows */}
                  <td className="p-2">
                    <div className="flex items-center justify-center gap-2">
                      {/* {priority} */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        style={{ transform: "rotate(180deg)" }}
                        className={`size-6 cursor-pointer ${
                          priority === 3 || priority === 0 ? "invisible" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          changePriority(file, +1); // Right → higher priority
                        }}
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <div
                        className={`w-3 h-3 rounded-full ${getPriorityColor(
                          priority
                        )}`}
                        title={`Priority ${priority}`}
                      ></div>

                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className={`size-6 cursor-pointer ${
                          priority === 1 || priority === 0 ? "invisible" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          changePriority(file, -1); // Right → higher priority
                        }}
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </td>

                  {/* Progress + Ratio beside it */}
                  <td className="p-2 w-60">
                    <div className="flex items-center gap-2">
                      <div className="flex-none w-36 mr-1 bg-gray-700 rounded h-4">
                        <div
                          className="h-4 rounded text-xs text-center text-white bg-green-500"
                          style={{ width: `${percent}%` }}
                        >
                          <span>
                            {isNaN(percent) ? "0%" : `${percent.toFixed(0)}%`}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-300">
                        {file.ratio || "-"}
                      </span>

                      {percent < 100 && (
                        <svg
                          onClick={() => stopConversion(file)}
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="1.5"
                          stroke="currentColor"
                          className="size-5 cursor-pointer"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                          />
                        </svg>
                      )}
                    </div>
                  </td>

                  <td className="p-2">{file.startTime ?? "-"}</td>
                  <td className="p-2 text-center">
                    {file.completedTime ?? "-"}
                  </td>
                  <td className="p-2">{file.output?.fileName || "-"}</td>
                  <td className="p-2">{file.input?.videoCodec}</td>
                  <td className="p-2">{file.output?.videoCodec}</td>
                  <td className="p-2">
                    <div className="flex">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        onClick={() => setData(file)}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="size-6 cursor-pointer"
                      >
                        <path
                          fillRule="evenodd"
                          d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 0 1 .67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 1 1-.671-1.34l.041-.022ZM12 9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"
                          clipRule="evenodd"
                        />
                      </svg>

                      {file.completedTime ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          onClick={() => removeData(file)}
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="size-6 cursor-pointer"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        ""
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
};

export default FileTable;
