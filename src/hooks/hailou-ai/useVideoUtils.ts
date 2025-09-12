import { useCallback } from "react";

// Hook for video utils
export const useVideoUtils = () => {
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const getVideoType = useCallback((url: string) => {
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      return "youtube";
    } else if (url.includes("vimeo.com")) {
      return "vimeo";
    }
    return "direct";
  }, []);

  const handleProgressClick = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      duration: number,
      seekTo: (time: number) => void
    ) => {
      if (duration) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const newTime = percent * duration;
        seekTo(newTime);
      }
    },
    []
  );

  return {
    formatTime,
    getVideoType,
    handleProgressClick,
  };
};
