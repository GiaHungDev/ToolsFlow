import { useEffect } from "react";

// Hook for video events
export const useVideoEvents = (
  videoRef: React.RefObject<HTMLVideoElement>,
  videoUrl: string | undefined,
  setDuration: (duration: number) => void,
  setCurrentTime: (time: number) => void,
  setIsPlaying: (playing: boolean) => void
) => {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, [videoUrl, videoRef, setDuration, setCurrentTime, setIsPlaying]);
};
