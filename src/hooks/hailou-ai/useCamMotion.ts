import { CinematicPreset, cinematicPresets } from "@/types/cinematicPresets";
import { useEffect, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { CreateVideoFormValues } from "./useCreateVideoForm";
import { setFormValues } from "@/utils/formHelpers";
import { Notify } from "@/lib/Notify";

export const useCamMotion = (
  formVideo: UseFormReturn<CreateVideoFormValues>
) => {
  const [selectedPreset, setSelectedPreset] = useState<CinematicPreset | null>(
    null
  );
  const [hoveredPreset, setHoveredPreset] = useState<number | null>(null);
  const [openCamMotion, setOpenCamMotion] = useState(false);

  // Sử dụng refs để kiểm soát video
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});

  // Effect để điều khiển video khi hover thay đổi
  useEffect(() => {
    cinematicPresets.forEach((preset) => {
      const video = videoRefs.current[preset.id];
      if (video) {
        if (hoveredPreset === preset.id) {
          video.currentTime = 0; // Reset về đầu
          video.play().catch(console.error); // Play video
        } else {
          video.pause();
          video.currentTime = 0; // Reset về đầu khi stop
        }
      }
    });
  }, [hoveredPreset]);

  const handleMouseEnter = (presetId: number) => {
    setHoveredPreset(presetId);
  };

  const handleMouseLeave = () => {
    setHoveredPreset(null);
  };

  const handleOpenCamMotion = () => {
    setOpenCamMotion(true);
  };

  const handleCancelCamMotion = () => {
    let currentDescription = formVideo.getValues("description") || "";

    currentDescription = currentDescription
      .replace(/Camera movement: \[[^\]]*\]/g, "")
      .trim();

    setFormValues(formVideo, { description: currentDescription || "" });
    setOpenCamMotion(false);
    setSelectedPreset(null);
  };

  const handlePresetSelect = (preset: CinematicPreset) => {
    setSelectedPreset(preset);
  };

  const handleSubmitCamMotion = () => {
    let currentDescription = formVideo.getValues("description") || "";

    currentDescription = currentDescription
      .replace(/Camera movement: \[[^\]]*\]/g, "")
      .trim();

    if (selectedPreset) {
      const newDescription =
        `${currentDescription} Camera movement: [${selectedPreset.promptKey}]`.trim();
      setFormValues(formVideo, { description: newDescription });

      Notify({
        title: "Đã chọn góc quay",
        description: `Đã chọn góc quay ${selectedPreset.label}`,
        status: "success",
      });
    }

    setOpenCamMotion(false);
  };

  return {
    setSelectedPreset,
    selectedPreset,
    setHoveredPreset,
    hoveredPreset,
    setOpenCamMotion,
    openCamMotion,
    handleOpenCamMotion,
    handleCancelCamMotion,
    handlePresetSelect,
    handleSubmitCamMotion,
    videoRefs,
    handleMouseEnter,
    handleMouseLeave,
  };
};
