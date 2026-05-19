"use client";

import { useFormFilter } from "@/hooks/flow-ai/useFormFilter";
import { useFormVideo } from "@/hooks/flow-ai/useFormVideo";
import ApiKeySection from "./TopicSection";
import CreateTopicT2VContent from "./CreateTopicT2VContent";
import React, { useState } from "react";
import { FormData, Scene, ApiKey, Preset } from "./types";
import { useAppSelector } from "@/lib/redux/store";
import { useListPromptModal } from "@/hooks/flow-ai/useListPromptModal";
import TableSection from "./TableSection";
import Results from "./modals/Results";
import Veo3Section from "./Veo3Section";
import { Notify } from "@/lib/Notify";

interface FlowAIProp {
  formVideo: ReturnType<typeof useFormVideo>;
  formFilter: ReturnType<typeof useFormFilter>;
}

const FlowAI: React.FC<FlowAIProp> = ({ formVideo, formFilter }) => {

  const [step, setStep] = useState(1);
  const [activeApiKey, setActiveApiKey] = useState<ApiKey | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [feedback, setFeedback] = useState<{
    type: "error" | "success" | "info";
    message: string;
  } | null>(null);

  const handleSavePresets = (newPresets: Preset[]) => {
    setPresets(newPresets);
  };

  const ownerId = useAppSelector((s) => s.auth?.user?.id);
  const { createVideosFromScenes } = useListPromptModal();

  const [generatedScenes, setGeneratedScenes] = useState<Scene[]>([]);
  const [topicFormData, setTopicFormData] = useState<FormData | null>(null);
  const [validImages, setValidImages] = useState<any[]>([]);
  const [projectName, setProjectName] = useState("");

  const handleGenerationComplete = (scenes: Scene[], formData: FormData, images: any[]) => {
    setGeneratedScenes(scenes);
    setTopicFormData(formData);
    setValidImages(images);
    setStep(3); // Go to Storyboard
  };

  const handleGenerateSuccess = (scenes: Scene[], formData: FormData) => {
    setStep(4); // Chuyển sang Step 4: Danh sách video
  };



  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const handleAddKey = (key: ApiKey) => {
    setApiKeys((prev) => [...prev, key]);
  };
  const handleDeleteKey = (keyId: string) => {
    setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
  };
  const handleSelectKey = (key: ApiKey) => {
    setActiveApiKey(key);
  };

  const handleKeysInit = (keys: ApiKey[]) => {
    setApiKeys(keys);
  };

  return (
    <div className="flex flex-col h-full max-h-full relative">
      {/* Back Button for Steps > 1 */}
      {step > 1 && (
        <button
          onClick={() => setStep(step - 1)}
          className="absolute left-4 top-4 md:left-8 md:top-6 z-10 flex items-center gap-2 px-4 py-2 text-sm font-bold text-stone-500 bg-white/80 backdrop-blur-sm hover:bg-white hover:text-stone-700 rounded-xl transition border border-stone-200 shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Quay lại {step === 2 ? "Chọn Khóa" : step === 3 ? "Kịch Bản" : "Storyboard"}
        </button>
      )}

      {/* Save Button for Step 3 */}
      {step === 3 && (
        <div className="absolute right-4 top-4 md:right-8 md:top-6 z-10 flex items-center gap-3">
          <input
            type="text"
            placeholder="Nhập tên dự án..."
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="px-4 py-2 text-sm font-medium border-2 border-emerald-500/50 bg-white/90 backdrop-blur-sm rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 shadow-sm transition-all w-48 md:w-64"
          />
          <button
            type="button"
            onClick={async (e) => {
              e.preventDefault();
              if (!projectName.trim()) {
                Notify({
                  title: "Lỗi",
                  description: "Vui lòng nhập tên dự án.",
                  status: "error",
                });
                return;
              }
              if (!ownerId || !topicFormData) {
                setFeedback({
                  type: "error",
                  message: "Thiếu dữ liệu hoặc chưa đăng nhập.",
                });
                return;
              }
              await createVideosFromScenes(generatedScenes, ownerId, validImages, projectName.trim());
              handleGenerateSuccess(generatedScenes, topicFormData);
              // Clear storyboard states to prevent overwriting next time
              setGeneratedScenes([]);
              setTopicFormData(null);
              setValidImages([]);
              setProjectName("");
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition border border-emerald-600 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            Lưu {generatedScenes.length} cảnh và theo dõi
          </button>
        </div>
      )}

      {/* Dynamic Action Container for Step 4+ */}
      <div id="step-right-actions" className="absolute right-4 top-4 md:right-8 md:top-6 z-10 flex items-center gap-2"></div>

      {feedback && (
        <div
          className={`fixed top-5 right-5 z-50 p-4 rounded-xl shadow-2xl border-2 animate-in slide-in-from-right duration-300 flex items-center gap-3 ${feedback.type === "error"
              ? "bg-red-50 border-red-200 text-red-600"
              : feedback.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                : "bg-blue-50 border-blue-200 text-blue-600"
            }`}
        >
          <span className="font-bold text-sm">{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-xl leading-none hover:opacity-70"
          >
            ×
          </button>
        </div>
      )}

      {/* Stepper Header */}
      <div className="flex items-center justify-center pt-4 md:pt-6 mb-6 flex-shrink-0 relative">
        <div className="flex items-center bg-white rounded-full px-6 py-2 shadow-sm border border-stone-200">
          {[
            { num: 1, title: "API Key", icon: "Key" },
            { num: 2, title: "Kịch Bản", icon: "FileText" },
            { num: 3, title: "Storyboard", icon: "Layout" },
            { num: 4, title: "Video", icon: "Film" },
            { num: 5, title: "Veo3", icon: "MonitorPlay" },
          ].map((s, idx) => {
            const isActive = step === s.num;
            const isPast = step > s.num;
            return (
              <React.Fragment key={s.num}>
                <div
                  className={`flex items-center gap-2 px-5 py-2 rounded-full transition-all duration-300 ${isActive
                      ? "bg-emerald-500 text-white shadow-md"
                      : isPast
                        ? "text-emerald-600 hover:text-emerald-700 cursor-pointer"
                        : "text-stone-400 hover:text-stone-600 cursor-pointer"
                    }`}
                  onClick={() => {
                    setStep(s.num);
                  }}
                >
                  <span className={`flex items-center justify-center ${isActive ? "text-white" : isPast ? "text-emerald-500" : "text-stone-400"}`}>
                    {s.icon === "Key" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /><path d="m21 2-9.6 9.6" /><circle cx="7.5" cy="15.5" r="5.5" /></svg>
                    )}
                    {s.icon === "FileText" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
                    )}
                    {s.icon === "Layout" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
                    )}
                    {s.icon === "Film" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" /></svg>
                    )}
                    {s.icon === "MonitorPlay" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/><polygon points="10 7 15 10 10 13 10 7"/></svg>
                    )}
                  </span>
                  <span className="font-bold text-sm tracking-wide">
                    {s.title}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white ml-1 opacity-90"></span>
                  )}
                </div>
                {idx < 4 && (
                  <div className={`w-8 h-[2px] mx-2 transition-colors duration-300 ${isPast ? "bg-emerald-200" : "bg-stone-200"}`}></div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 relative">
        {step === 1 && (
          <div className="h-full overflow-y-auto p-4 md:p-8 custom-scrollbar">
            <ApiKeySection
              apiKeys={apiKeys}
              onKeyAdd={handleAddKey}
              onKeyDelete={handleDeleteKey}
              onKeySelect={handleSelectKey}
              handleOpenTopicModal={() => setStep(2)}
              onKeysInit={handleKeysInit}
              userId={ownerId?.toString() || ""}
            />
          </div>
        )}

        {step === 2 && (
          <CreateTopicT2VContent
            activeApiKey={activeApiKey}
            presets={presets}
            onSavePresets={handleSavePresets}
            onGenerateSuccess={handleGenerateSuccess}
            onGenerationComplete={handleGenerationComplete}
            onFeedback={setFeedback}
            onCancel={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <div className="h-full w-full overflow-y-auto custom-scrollbar">
            <div className="w-full max-w-[1600px] mx-auto p-4 md:px-8 space-y-6">
              <Results scenes={generatedScenes} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="h-full w-full overflow-y-auto custom-scrollbar">
            <div className="w-full mx-auto p-4 md:px-8 space-y-6">
              <TableSection formVideo={formVideo} formFilter={formFilter} />
            </div>
          </div>
        )}

        {step === 5 && (
          <Veo3Section />
        )}
      </div>

    </div>
  );
};

export default FlowAI;
