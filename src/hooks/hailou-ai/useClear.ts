import { ITopic } from "@/types/hailuo";
import { clearAllFields } from "@/utils/formHelpers";
import { CinematicPreset } from "@/types/cinematicPresets";
import { useFormVideo } from "./useFormVideo";

interface UseClearProp {
  handleSetTopic: (topic: ITopic | null) => void;
  formVideo: ReturnType<typeof useFormVideo>;
  setSelectedPreset: (preset: CinematicPreset | null) => void;
}

export const useClear = ({
  handleSetTopic,
  formVideo,
  setSelectedPreset,
}: UseClearProp) => {
  const handleClearCreateVideo = () => {
    handleSetTopic(null);
    clearAllFields(formVideo);
    setSelectedPreset(null);
    
  };

  return {
    handleClearCreateVideo,
  };
};
