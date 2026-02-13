import React, { useEffect, useState } from "react";
import axios from "axios";
const serverIP = import.meta.env.VITE_SERVER_IP;
const serverPort = import.meta.env.VITE_SERVER_PORT;
interface HotfolderSettings {
    watchFolder: string;
    outputFolder: string;
    errorFolder: string;
    watchdogRate: string;
    transcodeSetting: {
        name: string;
        outputFormat: string;
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
}


// interface Props {
//     initialSettings: Record<string, HotfolderSettings>;
//     onSettingsChange?: (settings: Record<string, HotfolderSettings>) => void;
//     editTranscodeSetting: (hotfolder: any, id: number) => void;
// }

interface Props {
    initialSettings: Record<string, HotfolderSettings>;
    onSettingsChange?: (settings: Record<string, HotfolderSettings>) => void;
    editTranscodeSetting: (hotfolder: any, id: number, isEdit: boolean) => void;
    formData: any; // 👈 add this
    hotfolder: number;
}


const HotfolderSettings: React.FC<Props> = ({ initialSettings, onSettingsChange, editTranscodeSetting, formData, hotfolder }) => {
    const [hotfolderSettings, setHotfolderSettings] = useState(initialSettings);
    const [selectedHotfolder, setSelectedHotfolder] = useState<number>(0);
    const [isEdit, setIsEdit] = useState<boolean>(false);

    const editHotfolder = (setting: any, id: number, isEdit: boolean) => {
        setSelectedHotfolder(id);
        setIsEdit(isEdit)

        // Ensure transcodeSetting exists
        const transcodeSetting = setting.transcodeSetting || {};
        // console.log('transcodeSetting');
        // console.log(transcodeSetting);
        
        // Send both hotfolder and its transcodeSetting to parent
        editTranscodeSetting({
            ...setting,
            transcodeSetting,
        }, id, isEdit);
    };

    const handleFieldChange = (id: string, field: keyof HotfolderSettings, value: string) => {
        setHotfolderSettings((prev) => {
            const updated = {
                ...prev,
                [id]: { ...prev[id], [field]: value },
            };
            onSettingsChange?.(updated);
            return updated;
        });
    };

    // ✅ Load from backend when mounted
    useEffect(() => {
        axios.get(`http://${serverIP}:${serverPort}/api/hotfiles`)
            .then((res) => {
                setHotfolderSettings(res.data);
                onSettingsChange?.(res.data);
            })
            .catch((err) => console.error("❌ Failed to load hotfiles.json:", err));
    }, []);

    useEffect(() => {
        if (hotfolder === 0) {
            setSelectedHotfolder(0);
        }
    }, [hotfolder])

    const saveHotfolderSettings = async (setting: any, id: number) => {
        try {
            const updatedHotfolder = {
                ...hotfolderSettings[id],
                transcodeSetting: {
                    ...formData,
                    outputFormat: formData.fileType,
                }, // 👈 save current formData here
            };

            await axios.post(`http://${serverIP}:${serverPort}/api/hotfiles/save`, {
                [id]: updatedHotfolder,
            });

            // console.log("✅ Saved hotfolder + transcodeSetting:", updatedHotfolder);

            setHotfolderSettings((prev) => ({
                ...prev,
                [id]: updatedHotfolder,
            }));

            onSettingsChange?.({
                ...hotfolderSettings,
                [id]: updatedHotfolder,
            });
        } catch (err) {
            console.error("❌ Failed to save hotfolder settings:", err);
        }
        editHotfolder('', 0, false);
    };


    const renderHotfolder = (id: string, label: string) => {
        const setting = hotfolderSettings[id] || {
            watchFolder: "",
            outputFolder: "",
            errorFolder: "",
            watchdogRate: "0 Secs (default - constant folder check)",
        };
        const isEditing = selectedHotfolder === Number(id) && isEdit;

        return (
            <div key={id} className="flex-1 text-center group">
                <div className="flex justify-center">
                    {isEditing ? (
                        <button
                            className="rounded-full pr-4 pl-4 text-[13px] bg-green-400 text-black pt-1 pb-1 -mt-1 mr-2 cursor-pointer relative -top-2"
                            onClick={() => saveHotfolderSettings(setting, Number(id))}
                        >
                            Save
                        </button>
                    ) : (
                        <svg
                            onClick={() => editHotfolder(setting, Number(id), true)}
                            className="size-6 cursor-pointer"
                            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" >
                            <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z" />
                            <path d="M5.25 5.25a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V13.5a.75.75 0 0 0-1.5 0v5.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h5.25a.75.75 0 0 0 0-1.5H5.25Z" />
                        </svg>
                    )}

                    {isEditing && (
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="1.5"
                            stroke="currentColor"
                            onClick={() => editHotfolder('', 0, false)}
                            className="size-6 mr-3 cursor-pointer relative -top-2"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                            />
                        </svg>
                    )}
                    {isEditing ? '' :
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="1.5"
                            stroke="currentColor"
                            onClick={() => editHotfolder(setting, Number(id), false)}
                            className={`size-6 ${selectedHotfolder === Number(id) && !isEdit ? "text-green-500" : ""} cursor-pointer`}
                        // onClick={() => editHotfolder(setting, Number(id))}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                            />
                        </svg>
                    }
                </div>

                <div className="grid gird-flow-row-dense grid-cols-4 gap-1 text-[13px]">
                    <div className="text-right">{label} :</div>
                    <div className="col-span-3 pl-2 text-left">
                        {isEditing ? (
                            <input
                                type="text"
                                className="ignisSelect"
                                value={setting.watchFolder}
                                onChange={(e) => handleFieldChange(id, "watchFolder", e.target.value)}
                            />
                        ) : (
                            <span
                                className="inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse"
                                title={setting.watchFolder}
                            >
                                {setting.watchFolder || "—"}
                            </span>
                        )}
                    </div>

                    <div className="text-right">Output Folder :</div>
                    <div className="col-span-3 pl-2 text-left">
                        {isEditing ? (
                            <input
                                type="text"
                                className="ignisSelect"
                                value={setting.outputFolder}
                                onChange={(e) => handleFieldChange(id, "outputFolder", e.target.value)}
                            />
                        ) : (
                            <span
                                className="inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse"
                                title={setting.outputFolder}
                            >
                                {setting.outputFolder || "—"}
                            </span>
                        )}
                    </div>

                    <div className="text-right">Error Folder :</div>
                    <div className="col-span-3 pl-2 text-left">
                        {isEditing ? (
                            <input
                                type="text"
                                className="ignisSelect"
                                value={setting.errorFolder}
                                onChange={(e) => handleFieldChange(id, "errorFolder", e.target.value)}
                            />
                        ) : (
                            <span
                                className="inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse"
                                title={setting.errorFolder}
                            >
                                {setting.errorFolder || "—"}
                            </span>
                        )}
                    </div>

                    <div className="text-right">Watchdog Rate :</div>
                    <div className="col-span-3 pl-2 text-left">
                        {isEditing ? (
                            <input
                                type="text"
                                className="ignisSelect"
                                value={setting.watchdogRate}
                                onChange={(e) => handleFieldChange(id, "watchdogRate", e.target.value)}
                            />
                        ) : (
                            <span
                                className="inline-block max-w-[240px] truncate align-middle text-ellipsis-reverse"
                                title={setting.watchdogRate}
                            >
                                {setting.watchdogRate === '0' ? '0 Secs (default - constant folder check)' : setting.watchdogRate || "—"}
                            </span>
                        )}
                        {/* {setting.watchdogRate || "0 Secs (default - constant folder check)"} */}
                    </div>
                </div>

            </div>
        );
    };

    return (
        <div className="flex w-full items-center pb-5">
            {Object.keys(hotfolderSettings).length === 0 ? (
                <div className="text-center text-gray-400 w-full mt-4">
                    Loading Hotfolder Settings...
                </div>
            ) : (
                <div className="flex w-full justify-center mt-3">
                    {["1", "2", "3"].map((id, idx) => (
                        <React.Fragment key={id}>
                            {renderHotfolder(id, `Watchfolder ${id}`)}
                            {idx < 2 && (
                                <div className="h-20 w-px relative top-5 bg-[#707D86] mx-4"></div>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};

export default HotfolderSettings;
