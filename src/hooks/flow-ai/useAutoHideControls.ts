import { useEffect, useState } from "react";

// Hook for auto-hide controls
export const useAutoHideControls = (
  containerRef: React.RefObject<HTMLDivElement>,
  isPlaying: boolean
) => {
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const node = containerRef.current;

    const hideControls = () => {
      timeout = setTimeout(() => {
        if (isPlaying) {
          setShowControls(false);
        }
      }, 3000);
    };

    const showControlsHandler = () => {
      setShowControls(true);
      clearTimeout(timeout);
      hideControls();
    };

    const handleMouseLeave = () => {
      if (isPlaying) {
        setShowControls(false);
      }
    };

    if (node) {
      node.addEventListener("mousemove", showControlsHandler);
      node.addEventListener("mouseleave", handleMouseLeave);
    }

    if (isPlaying) {
      hideControls();
    } else {
      setShowControls(true);
    }

    return () => {
      clearTimeout(timeout);
      if (node) {
        node.removeEventListener("mousemove", showControlsHandler);
        node.removeEventListener("mouseleave", handleMouseLeave);
      }
    };
  }, [isPlaying, containerRef]);

  return showControls;
};
