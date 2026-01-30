import { useAppSelector } from "@/lib/redux/store";
import { useState } from "react";
import axiosClient from "@/lib/axiosClient";
import { getVeo3StreamUrlService } from "@/service/api/flowService";
export const usePlayVideo = () => {
  const { listFlowVideo } = useAppSelector((state) => state.flow);

  const [isOpenVideoModal, setIsOpenVideoModal] = useState<boolean>(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState<boolean>(false);

  const handleOpenVideoModal = () => {
    setIsOpenVideoModal(true);
  };

  const handleCloseVideoModal = () => {
    setIsOpenVideoModal(false);
    setVideoUrl(null);
  };

  const pickUrl = (res: any): string | null => {
    if (!res) return null;
    if (typeof res.url === "string") return res.url;
    if (typeof res.url?.url === "string") return res.url.url;
    return null;
  };

  const handleShowVideo = async (id: string | number) => {
    try {
      if (!id) throw new Error("Không có ID");

      const checkVideo = listFlowVideo.find(
        (item) => Number(item.id) === Number(id),
      );

      if (!checkVideo) throw new Error(`Không tồn tại video với id ${id}`);

      setLoadingVideo(true);

      const res = await getVeo3StreamUrlService(Number(id));
      const url = pickUrl(res);

      if (!url) throw new Error("BE không trả stream url");

      setVideoUrl(url); 
      handleOpenVideoModal();
    } catch (error) {
      console.error("❌ Lỗi show video:", error);
    } finally {
      setLoadingVideo(false);
    }
  };

  return {
    setIsOpenVideoModal,
    isOpenVideoModal,
    handleOpenVideoModal,
    handleCloseVideoModal,
    handleShowVideo,
    videoUrl,
    loadingVideo,
  };
};
