// import { CinematicPreset, cinematicPresets } from "@/types/cinematicPresets";
// import { useEffect, useRef, useState } from "react";
// import { UseFormReturn } from "react-hook-form";
// import { setFormValues } from "@/utils/formHelpers";
// import { Notify } from "@/lib/Notify";
// import { CreateVideoFormValues } from "./useFormVideo";

// export const useCamMotion = (
//   formVideo: UseFormReturn<CreateVideoFormValues>
// ) => {
//   const [selectedPreset, setSelectedPreset] = useState<CinematicPreset | null>(
//     null
//   );
//   const [hoveredPreset, setHoveredPreset] = useState<number | null>(null);
//   const [openCamMotion, setOpenCamMotion] = useState(false);

//   // Sử dụng refs để kiểm soát video
//   const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});

//   // Effect để điều khiển video khi hover thay đổi
//   useEffect(() => {
//     cinematicPresets.forEach((preset) => {
//       const video = videoRefs.current[preset.id];
//       if (video) {
//         if (hoveredPreset === preset.id) {
//           video.currentTime = 0; // Reset về đầu
//           video.play().catch(console.error); // Play video
//         } else {
//           video.pause();
//           video.currentTime = 0; // Reset về đầu khi stop
//         }
//       }
//     });
//   }, [hoveredPreset]);

//   const handleMouseEnter = (presetId: number) => {
//     setHoveredPreset(presetId);
//   };

//   const handleMouseLeave = () => {
//     setHoveredPreset(null);
//   };

//   const handleOpenCamMotion = () => {
//     setOpenCamMotion(true);
//   };

//   const handleCancelCamMotion = () => {
//     let currentDescription = formVideo.getValues("description") || "";

//     currentDescription = currentDescription
//       .replace(/Camera movement: \[[^\]]*\]/g, "")
//       .trim();

//     setFormValues(formVideo, { description: currentDescription || "" });
//     setOpenCamMotion(false);
//     setSelectedPreset(null);
//   };

//   const handlePresetSelect = (preset: CinematicPreset) => {
//     setSelectedPreset(preset);
//   };

//   const handleSubmitCamMotion = () => {
//     let currentDescription = formVideo.getValues("description") || "";

//     currentDescription = currentDescription
//       .replace(/Camera movement: \[[^\]]*\]/g, "")
//       .trim();

//     if (selectedPreset) {
//       const newDescription =
//         `${currentDescription} Camera movement: [${selectedPreset.promptKey}]`.trim();
//       setFormValues(formVideo, { description: newDescription });

//       Notify({
//         title: "Góc quay đã được chọn",
//         description: `Góc quay "${selectedPreset.label}" đã được thêm vào mô tả video.`,
//         status: "success",
//       });
//     }

//     setOpenCamMotion(false);
//   };

//   return {
//     setSelectedPreset,
//     selectedPreset,
//     setHoveredPreset,
//     hoveredPreset,
//     setOpenCamMotion,
//     openCamMotion,
//     handleOpenCamMotion,
//     handleCancelCamMotion,
//     handlePresetSelect,
//     handleSubmitCamMotion,
//     videoRefs,
//     handleMouseEnter,
//     handleMouseLeave,
//   };
// };

import { CinematicPreset, cinematicPresets } from "@/types/cinematicPresets";
import { useEffect, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { setFormValues } from "@/utils/formHelpers";
import { Notify } from "@/lib/Notify";
import { CreateVideoFormValues } from "./useFormVideo";

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

  // const handleOpenCamMotion = () => {
  //   setOpenCamMotion(true);
  // };

  const handleCancelCamMotion = () => {
    // 👈 SỬA Ở ĐÂY
    let currentPrompt = formVideo.getValues("prompt") || ""; 

    currentPrompt = currentPrompt
      .replace(/Camera movement: \[[^\]]*\]/g, "")
      .trim();

    // 👈 SỬA Ở ĐÂY
    setFormValues(formVideo, { prompt: currentPrompt || "" }); 
    setSelectedPreset(null); // Giữ lại preset đã chọn nếu muốn, nhưng đặt null cho hành động hủy là đúng
    setOpenCamMotion(false);
  };

  const handlePresetSelect = (preset: CinematicPreset) => {
    setSelectedPreset(preset);
  };

  const handleSubmitCamMotion = () => {
    // 👈 SỬA Ở ĐÂY
    let currentPrompt = formVideo.getValues("prompt") || ""; 

    currentPrompt = currentPrompt
      .replace(/Camera movement: \[[^\]]*\]/g, "")
      .trim();

    if (selectedPreset) {
      const newPrompt =
        `${currentPrompt} Camera movement: [${selectedPreset.promptKey}]`.trim();
        
      // 👈 SỬA Ở ĐÂY
      setFormValues(formVideo, { prompt: newPrompt }); 

      Notify({
        title: "Góc quay đã được chọn",
        description: `Góc quay "${selectedPreset.label}" đã được thêm vào mô tả video.`,
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
    // handleOpenCamMotion,
    handleCancelCamMotion,
    handlePresetSelect,
    handleSubmitCamMotion,
    videoRefs,
    handleMouseEnter,
    handleMouseLeave,
  };
};
