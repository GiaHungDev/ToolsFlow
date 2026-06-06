import { useAppSelector } from "@/lib/redux/store";
import React, { useState, ChangeEvent } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { FormData, VideoType, Scene, ApiKey, MvGenre, Preset } from "./types";
import { storySystemPrompt, liveSystemPrompt } from "./constants";
import Results from "./modals/Results";
import { LoaderIcon, TrashIcon, UploadIcon } from "./modals/Icon";
import { useListPromptModal } from "@/hooks/flow-ai/useListPromptModal";
import { Notify } from "@/lib/Notify";



let ipcRenderer: any = null;

if (typeof window !== "undefined" && (window as any).require) {
  ipcRenderer = (window as any).require("electron").ipcRenderer;
}
export interface CreateTopicT2VContentProps {
  onCancel?: () => void;
  activeApiKey: ApiKey | null;
  presets: Preset[];
  onSavePresets: (newPresets: Preset[]) => void;
  onGenerateSuccess: (scenes: Scene[], formData: FormData) => void;
  onFeedback: (
    feedback: { type: "error" | "success" | "info"; message: string } | null,
  ) => void;
  onGenerationComplete?: (scenes: Scene[], formData: FormData, validImages: any[]) => void;
}

const CreateTopicT2VContent: React.FC<CreateTopicT2VContentProps> = ({
  activeApiKey,
  presets,
  onSavePresets,
  onGenerateSuccess,
  onFeedback,
  onCancel,
  onGenerationComplete,
}) => {
  const ownerId = useAppSelector((s) => s.auth?.user?.id);
  const { createVideosFromScenes } = useListPromptModal();
  const [videoType, setVideoType] = useState<VideoType>("story");
  const [isLoading, setIsLoading] = useState(false);
  const [generatedScenes, setGeneratedScenes] = useState<Scene[]>([]);

  const [newPresetName, setNewPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");

  const [formData, setFormData] = useState<FormData>({
    idea: "",
    liveAtmosphere: "",
    liveArtistImage: null,
    liveArtistName: "",
    liveArtist: "",
    songMinutes: "3",
    songSeconds: "30",
    projectName: "",
    model: "gemini-flash-lite-latest",
    mvGenre: "narrative",
    filmingStyle: "auto",
    country: "Vietnamese",
    musicGenre: "v-pop",
    customMusicGenre: "",
    characterConsistency: true,
    characterCount: 1,
    temperature: 0.3,
    uploadedImages: [null, null, null],
  });

  const mvGenreOptions: { value: MvGenre; label: string }[] = [
    { value: "narrative", label: "Kể chuyện / Phim ngắn" },
    { value: "cinematic-short-film", label: "Điện ảnh (Cinematic)" },
    { value: "performance", label: "Trình diễn / Biểu diễn" },
    { value: "dance-choreography", label: "Nhảy / Vũ đạo" },
    { value: "lyrical", label: "Video lời bài hát (Lyric)" },
    { value: "conceptual", label: "Nghệ thuật / Trừu tượng" },
    { value: "abstract-visualizer", label: "Hiệu ứng hình ảnh" },
    { value: "scenic", label: "Cảnh đẹp / Chill (Không người)" },
    { value: "animation", label: "Hoạt hình (2D/3D)" },
    { value: "one-take", label: "Một cú máy (One-shot)" },
    { value: "surreal", label: "Mộng mơ / Kỳ ảo" },
    { value: "sci-fi", label: "Khoa học viễn tưởng" },
    { value: "horror", label: "Kinh dị / Rùng rợn" },
    { value: "historical-period", label: "Cổ trang / Lịch sử" },
    { value: "retro-futurism", label: "Phong cách Retro" },
    { value: "social-commentary", label: "Phóng sự / Đời sống" },
    { value: "documentary", label: "Tài liệu" },
  ];

  const filmingStyleOptions = [
    { value: "auto", label: "AI tự chọn (Đẹp nhất)" },
    { value: "Vintage 35mm Film", label: "Màu phim cũ (Vintage)" },
    { value: "Sharp & Modern Digital", label: "Hiện đại & Sắc nét" },
    { value: "Artistic Black & White", label: "Đen trắng nghệ thuật" },
    { value: "Cinematic Neon Noir", label: "Neon (Cyberpunk)" },
    { value: "Dark & Moody Low-Key", label: "Tông tối / Tâm trạng" },
    { value: "Golden Hour Glow", label: "Nắng vàng (Golden Hour)" },
    { value: "Clean & Minimalist", label: "Tối giản (Minimalist)" },
    { value: "Surreal & Dreamlike", label: "Mộng mơ (Dreamy)" },
    { value: "Epic Drone Cinematography", label: "Quay Flycam" },
    { value: "High-Speed Slow Motion", label: "Quay chậm (Slow Motion)" },
    { value: "Macro & Extreme Close-up", label: "Cận cảnh chi tiết" },
    { value: "GoPro / POV", label: "Góc nhìn thứ nhất" },
    { value: "Found Footage / Handheld", label: "Cầm tay (Rung nhẹ)" },
    { value: "Wes Anderson Style", label: "Màu Pastel / Đối xứng" },
    { value: "80s VHS Look", label: "Băng từ (VHS)" },
    { value: "2D Animation (Ghibli Style)", label: "Hoạt hình Ghibli" },
    { value: "3D Animation (Pixar Style)", label: "Hoạt hình Pixar" },
  ];

  const countryOptions = [
    { value: "Vietnamese", label: "Việt Nam" },
    { value: "American", label: "Mỹ (American)" },
    { value: "British", label: "Anh (British)" },
    { value: "South Korean", label: "Hàn Quốc" },
    { value: "Japanese", label: "Nhật Bản" },
    { value: "Chinese", label: "Trung Quốc" },
    { value: "French", label: "Pháp" },
    { value: "Brazilian", label: "Brazil" },
    { value: "Spanish", label: "Tây Ban Nha" },
    { value: "Generic/International", label: "Quốc tế" },
  ];

  const musicGenreOptions = [
    { value: "v-pop", label: "V-Pop" },
    { value: "k-pop", label: "K-Pop" },
    { value: "us-uk-pop", label: "US-UK Pop" },
    { value: "jazz-bossa-nova", label: "Jazz Bossa Nova" },
    { value: "smooth-jazz", label: "Smooth Jazz" },
    { value: "edm", label: "EDM" },
    { value: "worship", label: "Nhạc Thờ Phụng" },
    { value: "country", label: "Nhạc Country" },
    { value: "other", label: "Khác (Nhập thủ công)" },
  ];

  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else if (name === "characterCount") {
      setFormData((prev) => ({ ...prev, [name]: parseInt(value, 10) }));
    } else if (name === "temperature") {
      setFormData((prev) => ({ ...prev, [name]: parseFloat(value) }));
    } else if (name === "songMinutes") {
      if (value === "") {
        setFormData((prev) => ({ ...prev, songMinutes: "" }));
        return;
      }
      let val = parseInt(value);
      if (isNaN(val)) val = 0;
      if (val < 0) val = 0;
      if (val > 15) val = 15;
      setFormData((prev) => ({
        ...prev,
        songMinutes: val.toString(),
        songSeconds: val === 15 ? "0" : prev.songSeconds,
      }));
    } else if (name === "songSeconds") {
      let val = parseInt(value);
      if (isNaN(val) || val < 0) val = 0;
      setFormData((prev) => {
        if (parseInt(prev.songMinutes) >= 15)
          return { ...prev, songSeconds: "0" };
        if (val > 59) val = 59;
        return { ...prev, songSeconds: val.toString() };
      });
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };



  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] as any;
    if (!file) {
      setFormData((prev) => ({ ...prev, liveArtistImage: null }));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result && typeof reader.result === "string") {
        const base64Data = reader.result.split(",")[1];
        if (base64Data)
          setFormData((prev) => ({
            ...prev,
            liveArtistImage: {
              base64: base64Data,
              mimeType: file.type,
              name: file.name, 
              path: file.path || file.name, 
            },
          }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleMultiImageUpload =
    (index: number) => (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] as any;
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result && typeof reader.result === "string") {
          const base64Data = reader.result.split(",")[1];
          if (base64Data) {
            setFormData((prev) => {
              const updated = [...prev.uploadedImages];
              updated[index] = {
                base64: base64Data,
                mimeType: file.type,
                name: file.name,
                path: file.path || file.name,
              };
              return { ...prev, uploadedImages: updated };
            });
          }
        }
      };
      reader.readAsDataURL(file);
    };

  const clearImage = (index: number) => {
    setFormData((prev: any) => {
      const updated = [...(prev.uploadedImages || [null, null, null])];
      updated[index] = null;
      return { ...prev, uploadedImages: updated };
    });
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) {
      onFeedback({ type: "error", message: "Vui lòng nhập tên cài đặt." });
      return;
    }
    const newPreset: Preset = {
      id: crypto.randomUUID(),
      name: newPresetName.trim(),
      settings: formData,
    };
    const updated = [...presets, newPreset];
    onSavePresets(updated);
    setNewPresetName("");
    onFeedback({ type: "success", message: "Đã lưu cài đặt!" });
  };

  const handlePresetSelect = (pid: string) => {
    setSelectedPresetId(pid);
    const p = presets.find((pre) => pre.id === pid);
    if (p) {
      setFormData((prev) => ({ ...prev, ...p.settings }));
      onFeedback({ type: "info", message: `Đã tải: ${p.name}` });
    }
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) return;
    onSavePresets(presets.filter((p) => p.id !== selectedPresetId));
    setSelectedPresetId("");
  };

  const generatePrompts = async () => {
    if (!activeApiKey) {
      onFeedback({ type: "error", message: "Vui lòng chọn API Key." });
      return;
    }
    setIsLoading(true);
    onFeedback(null);
    setGeneratedScenes([]);

    const totalSeconds =
      (parseInt(formData.songMinutes) || 0) * 60 +
      (parseInt(formData.songSeconds) || 0);
    if (totalSeconds <= 0 || totalSeconds > 900) {
      onFeedback({
        type: "error",
        message: "Thời lượng không hợp lệ (1s - 15 phút).",
      });
      setIsLoading(false);
      return;
    }

    let sceneCount = Math.max(3, Math.round(totalSeconds / 8));
    const systemPrompt =
      videoType === "story" ? storySystemPrompt : liveSystemPrompt;
    let userPrompt = `Generate prompts for a music video.`;

    if (videoType === "story") {
      if (!formData.idea.trim()) {
        onFeedback({ type: "error", message: "Thiếu ý tưởng." });
        setIsLoading(false);
        return;
      }
      const genre =
        formData.musicGenre === "other"
          ? formData.customMusicGenre
          : formData.musicGenre;
      userPrompt += ` Input: "${formData.idea.trim()}". Specs: Nationality: ${formData.country
        }, Genre: ${formData.mvGenre}, Style: ${formData.filmingStyle
        }, Consistent: ${formData.characterConsistency}, Music Genre: ${genre}`;
    } else {
      userPrompt += ` Live Atmosphere: ${formData.liveAtmosphere}. Artist: ${formData.liveArtist}`;
    }
    userPrompt += ` Create exactly ${sceneCount} scenes.`;

    const parts: any[] = [{ text: userPrompt }];
    if (videoType === "live" && formData.liveArtistImage) {
      parts.push({
        inlineData: {
          mimeType: formData.liveArtistImage.mimeType,
          data: formData.liveArtistImage.base64,
        },
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: activeApiKey.value });
      const response = await ai.models.generateContent({
        model: formData.model,
        contents: { parts: parts },
        config: {
          systemInstruction: systemPrompt,
          temperature: formData.temperature,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prompts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    scene_number: { type: Type.INTEGER },
                    scene_title: { type: Type.STRING },
                    prompt_text: { type: Type.STRING },
                  },
                  required: ["scene_number", "scene_title", "prompt_text"],
                },
              },
            },
            required: ["prompts"],
          },
        },
      });

      const parsedData = JSON.parse(response.text || "{}");
      if (parsedData.prompts) {
        setGeneratedScenes(parsedData.prompts);

        // Gom ảnh hợp lệ
        let validImages: any[] = [];
        if (videoType === "story") {
          validImages = formData.uploadedImages.filter((img) => img !== null);
        } else {
          if (formData.liveArtistImage) {
            validImages.push(formData.liveArtistImage);
          }
        }

        if (onGenerationComplete) {
          onGenerationComplete(parsedData.prompts, formData, validImages);
        }

        if (ipcRenderer) ipcRenderer.invoke("increment-prompt-count");
      } else throw new Error("Invalid AI response");
    } catch (err: any) {
      onFeedback({ type: "error", message: `Lỗi: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  };

  const adjustTime = (field: "songMinutes" | "songSeconds", amount: number) => {
    setFormData((prev) => {
      let currentVal = parseInt(prev[field] || "0");
      if (isNaN(currentVal)) currentVal = 0;

      let newVal = currentVal + amount;

      if (field === "songMinutes") {
        if (newVal < 0) newVal = 0;
        if (newVal > 15) newVal = 15;
      } else {
        if (newVal < 0) newVal = 0;
        if (newVal > 59) newVal = 59;
      }

      return { ...prev, [field]: newVal.toString() };
    });
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <main className="py-2 space-y-5">
          <div className="flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center">

          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-8 space-y-6">




              <div className="bg-white/80 p-5 rounded-[32px] shadow-sm border-4 border-white relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-2 h-full bg-cute-mint"></div>
                <div className="absolute -top-6 -right-6 text-6xl opacity-10 rotate-12 select-none">
                  ⛄
                </div>
                <h3 className="text-cute-mint-dark font-black uppercase text-xs mb-6 tracking-widest flex items-center gap-2 pb-2">
                  1. Nội Dung Cốt Lõi
                </h3>
                {videoType === "story" ? (
                  <div>
                    <label className="block text-[12px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                      Ý Tưởng / Lời Bài Hát
                    </label>
                    <textarea
                      name="idea"
                      value={formData.idea}
                      onChange={handleInputChange}
                      rows={6}
                      className="w-full p-4 transition resize-none shadow-inner text-sm leading-relaxed rounded-2xl border-2 border-cute-mint/30 focus:border-cute-pink bg-cute-cream"
                      placeholder="Nhập lời bài hát hoặc mô tả chi tiết ý tưởng MV..."
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                        Không khí / Bối cảnh Live
                      </label>
                      <textarea
                        name="liveAtmosphere"
                        value={formData.liveAtmosphere}
                        onChange={handleInputChange}
                        rows={3}
                        className="w-full p-4 transition text-sm border-2 border-cute-mint/30 focus:border-cute-pink bg-cute-cream rounded-2xl"
                        placeholder="VD: Sân thượng lúc hoàng hôn, phòng thu ấm cúng với nến..."
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                          Tên Ca Sĩ
                        </label>
                        <input
                          type="text"
                          name="liveArtist"
                          value={formData.liveArtist}
                          onChange={handleInputChange}
                          className="w-full p-3 text-sm border-2 border-cute-mint/30 focus:border-cute-pink bg-cute-cream rounded-2xl"
                          placeholder="Tên nghệ sĩ..."
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                          Ảnh Ca Sĩ (AI nhận diện)
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="w-full p-2 text-stone-500 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-stone-200 file:text-stone-700 hover:file:bg-stone-300 border-2 border-cute-mint/30 bg-cute-cream rounded-2xl cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white/80 p-5 rounded-[32px] shadow-sm border-4 border-white relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-2 h-full bg-cute-yellow"></div>
                <div className="absolute -top-4 -right-2 text-6xl opacity-10 -rotate-12 select-none">
                  🎨
                </div>
                <h3 className="text-stone-600 font-black uppercase text-xs mb-6 tracking-widest flex items-center gap-2 pb-2">
                  2. Định Hướng Nghệ Thuật
                </h3>

                {videoType === "story" ? (
                  <div className="flex flex-col md:flex-row gap-6">
                    <div className="w-full md:w-1/3 flex flex-col gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">
                          Quốc Gia
                        </label>
                        <div className="relative">
                          <select
                            name="country"
                            value={formData.country}
                            onChange={handleInputChange}
                            className="w-full py-1.5 pl-3 pr-8 text-xs focus:border-cute-pink border border-cute-mint/40 bg-cute-cream rounded-xl appearance-none transition-all cursor-pointer hover:border-cute-mint"
                          >
                            {countryOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2.5}
                              stroke="currentColor"
                              className="w-3 h-3"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m19.5 8.25-7.5 7.5-7.5-7.5"
                              />
                            </svg>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">
                          Nhạc nền
                        </label>
                        <div className="relative">
                          <select
                            name="musicGenre"
                            value={formData.musicGenre}
                            onChange={handleInputChange}
                            className="w-full py-1.5 pl-3 pr-8 text-xs focus:border-cute-pink border border-cute-mint/40 bg-cute-cream rounded-xl appearance-none transition-all cursor-pointer hover:border-cute-mint"
                          >
                            {musicGenreOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2.5}
                              stroke="currentColor"
                              className="w-3 h-3"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m19.5 8.25-7.5 7.5-7.5-7.5"
                              />
                            </svg>
                          </div>
                        </div>

                        {formData.musicGenre === "other" && (
                          <div className="mt-2 animate-fade-in relative">
                            <input
                              type="text"
                              name="customMusicGenre"
                              value={formData.customMusicGenre}
                              onChange={handleInputChange}
                              className="w-full py-1.5 px-3 text-xs border-2 border-cute-pink/20 focus:border-cute-pink bg-white rounded-xl font-medium placeholder-stone-300 shadow-inner"
                              placeholder="Nhập thể loại nhạc..."
                            />
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">
                          Thể Loại MV
                        </label>
                        <div className="relative">
                          <select
                            name="mvGenre"
                            value={formData.mvGenre}
                            onChange={handleInputChange}
                            className="w-full py-1.5 pl-3 pr-8 text-xs focus:border-cute-pink border border-cute-mint/40 bg-cute-cream rounded-xl appearance-none transition-all cursor-pointer hover:border-cute-mint"
                          >
                            {mvGenreOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2.5}
                              stroke="currentColor"
                              className="w-3 h-3"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m19.5 8.25-7.5 7.5-7.5-7.5"
                              />
                            </svg>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">
                          Phong Cách Quay
                        </label>
                        <div className="relative">
                          <select
                            name="filmingStyle"
                            value={formData.filmingStyle}
                            onChange={handleInputChange}
                            className="w-full py-1.5 pl-3 pr-8 text-xs focus:border-cute-pink border border-cute-mint/40 bg-cute-cream rounded-xl appearance-none transition-all cursor-pointer hover:border-cute-mint"
                          >
                            {filmingStyleOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2.5}
                              stroke="currentColor"
                              className="w-3 h-3"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m19.5 8.25-7.5 7.5-7.5-7.5"
                              />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full md:w-2/3 flex flex-col justify-center border-2 border-stone-100 rounded-2xl bg-stone-50/50 p-4">
                      <label className="block text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-3 text-center">
                        Ảnh Gốc (Tự Động I2V)
                      </label>
                      <div className="flex flex-col gap-3 w-full">
                        {[0, 1, 2].map((idx) => (
                          <input
                            key={idx}
                            type="text"
                            value={formData.uploadedImages?.[idx]?.path || ""}
                            onChange={(e) => {
                              let val = e.target.value;
                              // Xoá dấu ngoặc kép hoặc ngoặc đơn ở đầu và cuối chuỗi nếu có
                              val = val.replace(/^["']|["']$/g, '').trim();

                              setFormData((prev: any) => {
                                const updated = [...(prev.uploadedImages || [null, null, null])];
                                if (val) {
                                  updated[idx] = {
                                    path: val,
                                    name: val.split('\\').pop() || val, // Lấy tên file từ đường dẫn
                                    base64: "", // Không cần base64 vì AI prompt không dùng ảnh này
                                    mimeType: "image/jpeg",
                                  };
                                } else {
                                  updated[idx] = null;
                                }
                                return { ...prev, uploadedImages: updated };
                              });
                            }}
                            placeholder={`Nhập đường dẫn ảnh ${idx + 1} (vd: C:\\IMAGE\\...)`}
                            className="w-full p-3 text-xs font-medium border-2 border-cute-mint/30 focus:border-cute-pink bg-white rounded-xl shadow-inner transition-colors text-stone-600"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-stone-400 italic text-sm">
                    Phong cách Live Acoustic được tối ưu hóa tự động bởi AI.
                  </div>
                )}
              </div>

            </div>

            <div className="xl:col-span-4 space-y-6">
              {videoType === "story" && (
                <div className="bg-white/80 p-5 rounded-[24px] shadow-sm border-2 border-white relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-cute-pink"></div>
                  <div className="absolute -top-4 -right-4 text-6xl opacity-10 rotate-45 select-none">
                    🎅
                  </div>
                  <div className="flex items-center justify-between mb-2 pb-2">
                    <h3 className="text-cute-pink-dark font-black uppercase text-xs tracking-widest">
                      3. Nhân Vật & Diễn Viên
                    </h3>
                  </div>
                  <div className="flex flex-col items-start gap-4 mt-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="charConsistency"
                        name="characterConsistency"
                        checked={formData.characterConsistency}
                        onChange={handleInputChange}
                        className="w-5 h-5 rounded accent-black cursor-pointer"
                      />
                      <div>
                        <label
                          htmlFor="charConsistency"
                          className="text-sm font-bold text-stone-700 cursor-pointer select-none tracking-wide block"
                        >
                          Đồng nhất nhân vật
                        </label>
                        <span className="text-[10px] text-stone-400">
                          AI sẽ giữ ngoại hình nhân vật giống nhau.
                        </span>
                      </div>
                    </div>

                    {formData.characterConsistency && (
                      <div className="flex items-center gap-4 bg-cute-cream px-6 py-1.5 rounded-xl border border-cute-mint/20 w-full justify-between">
                        <label className="text-[9px] text-stone-500 uppercase font-bold tracking-wider">
                          Số lượng:
                        </label>
                        <input
                          type="number"
                          name="characterCount"
                          value={formData.characterCount}
                          onChange={handleInputChange}
                          min={1}
                          max={3}
                          className="w-10 bg-white border border-stone-200 rounded-lg p-0.5 text-center text-stone-800 font-bold text-base focus:border-stone-400 focus:outline-none transition-all"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-white/90 p-5 rounded-[32px] border-4 border-white shadow-xl backdrop-blur-md relative overflow-hidden">
                <div className="absolute -top-6 -right-6 text-6xl opacity-10 rotate-12 select-none">
                  ❄️
                </div>
                <h3 className="text-cute-brown font-black uppercase text-xs mb-6 pb-2 tracking-widest flex items-center gap-2">
                  Cấu hình Dự Án
                </h3>

                <div className="mb-5">
                  <label className="block text-[12px] font-semibold text-stone-400 uppercase tracking-widest mb-2">
                    Thời lượng (Max 15 phút)
                  </label>

                  <div className="flex gap-4 mt-5">
                    {" "}
                    <div className="relative flex-1 group">
                      <button
                        onClick={() => adjustTime("songMinutes", -1)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-stone-400 hover:bg-rose-100 hover:text-rose-500 transition border border-stone-100 font-bold z-10"
                      >
                        -
                      </button>

                      <input
                        type="number"
                        name="songMinutes"
                        value={formData.songMinutes}
                        onChange={handleInputChange}
                        min="0"
                        max="15"
                        className="w-full bg-cute-cream border-2 border-cute-mint/30 rounded-2xl py-3 px-12 text-center font-black text-xl text-stone-700 focus:border-cute-pink transition shadow-inner"
                        placeholder="0"
                      />

                      <button
                        onClick={() => adjustTime("songMinutes", 1)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-stone-400 hover:bg-emerald-100 hover:text-emerald-500 transition border border-stone-100 font-bold z-10"
                      >
                        +
                      </button>

                      <span className="absolute -top-4 right-2 text-stone-400 text-[12px] uppercase font-bold bg-white px-1 rounded">
                        Phút
                      </span>
                    </div>
                    <div className="relative flex-1 group">
                      <button
                        onClick={() => adjustTime("songSeconds", -10)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-stone-400 hover:bg-rose-100 hover:text-rose-500 transition border border-stone-100 font-bold z-10"
                      >
                        -
                      </button>

                      <input
                        type="number"
                        name="songSeconds"
                        value={formData.songSeconds}
                        onChange={handleInputChange}
                        min="0"
                        max="59"
                        className="w-full bg-cute-cream border-2 border-cute-mint/30 rounded-2xl py-3 px-12 text-center font-black text-xl text-stone-700 focus:border-cute-pink transition shadow-inner"
                        placeholder="00"
                      />

                      <button
                        onClick={() => adjustTime("songSeconds", 10)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-stone-400 hover:bg-emerald-100 hover:text-emerald-500 transition border border-stone-100 font-bold z-10"
                      >
                        +
                      </button>

                      <span className="absolute -top-4 right-2 text-stone-400 text-[12px] uppercase font-bold bg-white px-1 rounded">
                        Giây
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mb-5">
                  <label className="block text-[12px] font-semibold text-stone-400 uppercase tracking-widest mb-2">
                    Model AI
                  </label>
                  <div className="relative">
                    <select
                      name="model"
                      value={formData.model}
                      onChange={handleInputChange}
                      className="w-full bg-cute-cream border-2 border-cute-mint/30 rounded-2xl p-3 pr-10 text-sm focus:border-cute-pink appearance-none cursor-pointer transition-all"
                    >
                      <option value="gemini-flash-lite-latest">
                        Gemini 2.5 Flash Lite (Mặc định)
                      </option>
                      <option value="gemini-flash-latest">
                        Gemini 2.5 Flash (Sáng tạo hơn)
                      </option>
                    </select>

                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                        className="w-4 h-4"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m19.5 8.25-7.5 7.5-7.5-7.5"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="mb-8 bg-stone-50 p-3 rounded-2xl border-2 border-stone-100">
                  <div className="flex justify-between mb-2">
                    <label className="text-[12px] font-semibold text-stone-400 uppercase tracking-widest">
                      Sáng tạo
                    </label>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${formData.temperature < 0.5
                        ? "bg-emerald-100 text-emerald-600"
                        : formData.temperature < 0.8
                          ? "bg-yellow-100 text-yellow-600"
                          : "bg-red-100 text-red-600"
                        }`}
                    >
                      {formData.temperature < 0.5
                        ? "An toàn"
                        : formData.temperature < 0.8
                          ? "Cân bằng"
                          : "Đột phá"}
                    </span>
                  </div>
                  <input
                    type="range"
                    name="temperature"
                    min="0"
                    max="1"
                    step="0.1"
                    value={formData.temperature}
                    onChange={handleInputChange}
                    className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-cute-pink"
                  />
                </div>

                <button
                  onClick={generatePrompts}
                  disabled={isLoading}
                  className="w-full py-4 bg-stone-200/50 hover:bg-stone-200/80 text-stone-700 font-bold text-sm uppercase tracking-widest rounded-2xl shadow-sm hover:shadow-md transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-3 border-4 border-white/60"
                >
                  {isLoading ? (
                    <>
                      <LoaderIcon /> PROCESSING...
                    </>
                  ) : (
                    "✨ TẠO KỊCH BẢN"
                  )}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CreateTopicT2VContent;
