import React, { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
const serverIP = import.meta.env.VITE_SERVER_IP;
const serverPort = import.meta.env.VITE_SERVER_PORT;
interface HotFile {
  fileName: string;
  filePath: string;
  addedAt: string;
}

const Settings: React.FC = () => {
  const [hotFiles, setHotFiles] = useState<HotFile[]>([]);
  const [, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    fetch(`http://${serverIP}:${serverPort}/api/hotfiles`)
      .then((res) => res.json())
      .then((data: HotFile[]) => setHotFiles(data));

    const s = io(`http://${serverIP}:${serverPort}`, { transports: ["websocket"] });
    setSocket(s);

    s.on("newVideo", (file: HotFile) => {
      setHotFiles((prev) => [file, ...prev]);
    });

    s.on("removedVideo", ({ fileName }: { fileName: string }) => {
      setHotFiles((prev) => prev.filter((f) => f.fileName !== fileName));
    });

    return () => { s.disconnect(); };
  }, []);

  const handleDelete = async (fileName: string) => {
    await fetch(`http://${serverIP}:${serverPort}/api/hotfiles/${fileName}`, {
      method: "DELETE",
    });
    // UI will auto-update from socket "removedVideo"
  };

  return (
    <div className="p-4 text-white">
      <h2 className="text-xl font-bold mb-4">Hotfolder Monitor</h2>
      {hotFiles.length === 0 ? (
        <p>No files detected yet...</p>
      ) : (
        <table className="w-full border border-gray-700">
          <thead>
            <tr className="bg-gray-800">
              <th className="p-2 text-left">File Name</th>
              <th className="p-2 text-left">Path</th>
              <th className="p-2 text-left">Added At</th>
              <th className="p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {hotFiles.map((f, idx) => (
              <tr key={idx} className="border-b border-gray-700">
                <td className="p-2">{f.fileName}</td>
                <td className="p-2">{f.filePath}</td>
                <td className="p-2">{new Date(f.addedAt).toLocaleTimeString()}</td>
                <td className="p-2">
                  <button
                    onClick={() => handleDelete(f.fileName)}
                    className="px-2 py-1 bg-red-600 rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Settings;
