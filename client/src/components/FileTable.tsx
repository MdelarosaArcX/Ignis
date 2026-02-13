import React, { useEffect, useState, useRef } from "react";
const serverIP = import.meta.env.VITE_SERVER_IP;
const serverPort = import.meta.env.VITE_SERVER_PORT;
export interface FileEntry {
  originalName: string;
  convertedName: string;
  convertedUrl: string;
  size: number;
  uploadedAt: string;
  startTime: string | null;
  completedTime: string | null;
  elapsed: string | null;
  duration: string | null;
  ratio: string | null;
  progress?: number;
}

interface Props {
  files: FileEntry[];
  refreshFiles: () => void;
}

const FileTable: React.FC<Props> = ({ files }) => {
  const [fileList, setFileList] = useState<FileEntry[]>(files);
  const sourcesRef = useRef<Record<string, EventSource>>({});

  // Sync prop files
  useEffect(() => {
    setFileList(files);
  }, [files]);

  // SSE progress polling
  useEffect(() => {
    fileList.forEach((file) => {
      const filename = file.convertedName;
      if (!filename || file.progress === 100) return;
      if (sourcesRef.current[filename]) return; // already polling

      const es = new EventSource(`http://${serverIP}:${serverPort}/api/progress/${filename}`);

      es.onmessage = (e) => {
        if (e.data === "STOPPED") {
          es.close();
          delete sourcesRef.current[filename];
          refreshFiles();
          return;
        }

        const pct = parseFloat(e.data);

        setFileList((prev) =>
          prev.map((f) => (f.convertedName === filename ? { ...f, progress: pct } : f))
        );

        if (pct >= 100) {
          es.close();
          delete sourcesRef.current[filename];
          refreshFiles();
        }
      };

      es.onerror = () => {
        es.close();
        delete sourcesRef.current[filename];
      };

      sourcesRef.current[filename] = es;
    });

    return () => {
      Object.values(sourcesRef.current).forEach((es) => es.close());
      sourcesRef.current = {};
    };
  }, [fileList]);

  const refreshFiles = async () => {
    try {
      const res = await fetch(`http://${serverIP}:${serverPort}/api/files`);
      const freshFiles: FileEntry[] = await res.json();
      setFileList(freshFiles);
    } catch (err) {
      console.error("Failed to refresh file list", err);
    }
  };

  // Stop conversion
  const stopConversion = async (file: FileEntry) => {
    try {
      const filename = file.convertedName;
      await fetch(`http://${serverIP}:${serverPort}/api/stop/${filename}`, { method: "POST" });

      // Stop SSE immediately
      if (sourcesRef.current[filename]) {
        sourcesRef.current[filename].close();
        delete sourcesRef.current[filename];
      }
      // delete sourcesRef.current[filename];
      // Refresh table  
      refreshFiles();
    } catch (err) {
      console.error("Failed to stop conversion", err);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Converted Files</h2>
      <table className="w-full table-auto border-collapse text-sm main-table border-none">
        <thead>
          <tr>
            <th className="p-2">#</th>
            <th className="p-2">Name</th>
            <th className="p-2">Priority</th>
            <th className="p-2">Progress</th>
            <th className="p-2">Start</th>
            <th className="p-2">Complete</th>
            <th className="p-2">Complete filename</th>
            <th className="p-2">I/P Codec</th>
            <th className="p-2">O/P Codec</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {fileList.map((file, idx) => {
            const percent = file.progress ?? 0;
            const isRunning = percent < 100;

            return (
              <tr
                key={file.convertedName}
                className="odd:bg-[#0F1921] even:bg-[#1C3343]"
              >
                <td className="p-2">{idx + 1}</td>
                <td className="p-2">{file.originalName}</td>
                <td className="p-2">O</td>
                <td className="p-2 w-48">
                  <div>
                    <div className="w-full">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-6 ml-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                      </svg>
                    </div>
                    <div className="w-full bg-gray-200 rounded h-4">
                      <div
                        className={`h-4 rounded text-xs text-center text-white ${
                          percent === 100 ? "bg-blue-600" : "bg-green-500"
                        }`}
                        style={{ width: `${percent}%` }}
                      >
                        {percent.toFixed(2)}%
                      </div>
                    </div>
                    <div className="w-full">{file.ratio || "-"}</div>
                  </div>
                </td>
                <td className="p-2">{file.startTime ?? "-"}</td>
                <td className="p-2">{file.completedTime ?? "-"}</td>
                <td className="p-2">{file.convertedName || "-"}</td>
                <td className="p-2">ProRes422HQ</td>
                <td className="p-2">H.264</td>
                <td className="p-2">
                  {isRunning && (
                    <button
                      className="px-2 py-1 bg-red-600 text-white rounded"
                      onClick={() => stopConversion(file)}
                    >
                      Stop
                    </button>
                  )}
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
