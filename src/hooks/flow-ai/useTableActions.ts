import { Notify } from "@/lib/Notify";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useCallback, useState } from "react";
import { useFormVideo } from "./useFormVideo";
import { setFormValues } from "@/utils/formHelpers";
import {
  deleteFlowVideo,
  getFlowVideo,
} from "@/lib/redux/slices/flowSlice";

interface UseTableActionsProp {
  formVideo: ReturnType<typeof useFormVideo>;
}

export const useTableActions = ({ formVideo }: UseTableActionsProp) => {
  const dispatch = useAppDispatch();

  const { listFlowVideo } = useAppSelector((state) => state.flow);
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [listSelectedId, setListSelectedId] = useState<(number | string)[]>([]);

  const handleSelectionChange = useCallback(
    (selectedIds: (string | number)[]): void => {
      setListSelectedId(selectedIds);
      if (selectedIds.length === 0) {
        setSelectedCount(0);
      } else {
        setSelectedCount(selectedIds.length);
      }
    },
    []
  );

  const handleDownloadVideo = async (id: string | number) => {
    try {
      if (!listFlowVideo) throw new Error("Không có dữ liệu có sẵn!");

      const check = listFlowVideo.find(
        (item) => Number(item.id) === Number(id)
      );

      if (!check) throw new Error("Không tìm thấy video cần tải!");
      if (!check.videoURL) {
        Notify({
          title: "Tải video lỗi",
          description: "Video chưa hoàn thành hoặc bị lỗi",
          status: "error",
        });
        throw new Error("Video chưa có URL để tải!");
      }

      // Fetch file về
      const response = await fetch(check.videoURL);
      const blob = await response.blob();

      // Luôn tải xuống qua trình duyệt
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `video_${id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(`Lỗi tải video: ${error}`);
    }
  };

  const handleDownloadVideos = async () => {
    try {
      if (!listFlowVideo) throw new Error("Không có dữ liệu có sẵn!");

      if (!listSelectedId) {
        Notify({
          title: "Chọn video cần tải",
          description: `Hãy chọn video cần tải`,
          status: "warning",
        });
        return;
      }

      for (const id of listSelectedId) {
        const check = listFlowVideo.find(
          (item) => Number(item.id) === Number(id)
        );

        if (!check) {
          console.warn(`Không tìm thấy video có id = ${id}`);
          continue;
        }

        if (!check.videoURL) {
          Notify({
            title: "Tải video lỗi",
            description: `Video ${id} chưa hoàn thành hoặc bị lỗi`,
            status: "error",
          });
          continue;
        }

        try {
          const response = await fetch(check.videoURL);
          const blob = await response.blob();

          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `video_${id}.mp4`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error(`Lỗi khi tải video ${id}`, err);
          Notify({
            title: "Tải video lỗi",
            description: `Không thể tải video ${id}`,
            status: "error",
          });
        }
      }
    } catch (error) {
      console.error(`Lỗi tải nhiều video: ${error}`);
    }
  };

  const handleRecreate = (id: string | number) => {
    try {
      if (!listFlowVideo) throw new Error("Không có dữ liệu có sẵn!");

      const check = listFlowVideo.find(
        (item) => Number(item.id) === Number(id)
      );

      if (!check) throw new Error("Không tìm thấy thông tin cần để tạo lại!");
      if (!check.prompt) {
        Notify({
          title: "Không có thông tin",
          description: "Video bị thiếu mô tả hoặc lỗi",
          status: "error",
        });
        throw new Error("Video không có prompt!");
      }

      if (formVideo) {
        setFormValues(formVideo, {
          description: check.prompt,
        });
        Notify({
          title: "Đã nạp dữ liệu",
          description:
            "Đã thêm mô tả video. Vui lòng chọn góc quay (nếu cần) và tải ảnh để tạo lại video.",
          status: "success",
        });
      }
    } catch (error) {
      console.error(`Lỗi tạo lại video: ${error}`);
    }
  };

  const handleDelete = async (id: string | number) => {
    try {
      await dispatch(deleteFlowVideo(Number(id)));
    } catch (error) {
      console.error(`Lỗi xóa video: ${error}`);
    }
  };

  const handleReload = async () => {
    try {
      await dispatch(
        getFlowVideo({
          page: 1,
          limit: 10,
          status: "completed",
        })
      );
    } catch (error) {
      console.error(`Lỗi reload video: ${error}`);
    }
  };

  return {
    handleSelectionChange,
    selectedCount,
    handleDownloadVideo,
    handleDownloadVideos,
    handleRecreate,
    handleDelete,
    handleReload,
  };
};
