import { useAppSelector } from "@/lib/redux/store";
import { useState } from "react";

export const usePlayVideo = () => {
  const { listHailuoVideo } = useAppSelector((state) => state.hailuo);

  const [isOpenVideoModal, setIsOpenVideoModal] = useState<boolean>(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleOpenVideoModal = () => {
    setIsOpenVideoModal(true);
  };

  const handleCloseVideoModal = () => {
    setIsOpenVideoModal(false);
    setVideoUrl(null);
  };

  const handleShowVideo = (id: string | number) => {
    try {
      if (!id) throw new Error("Không có ID");
      const checkVideo = listHailuoVideo.find(
        (item) => Number(item.id) === Number(id)
      );
      if (!checkVideo) throw new Error(`Không tồn tại video với id ${id}`);

      setVideoUrl(checkVideo.videoURL);
      handleOpenVideoModal();
    } catch (error) {
      console.error(`Lỗi kiểm tra show video: ${error}`);
    }
  };

  return {
    setIsOpenVideoModal,
    isOpenVideoModal,
    handleOpenVideoModal,
    handleCloseVideoModal,
    handleShowVideo,
    videoUrl,
  };
};
