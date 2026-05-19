import { Notify } from "@/lib/Notify";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useCallback, useState } from "react";
import { useFormVideo } from "./useFormVideo";
import { deleteFlowVideo, getFlowVideo } from "@/lib/redux/slices/flowSlice";
import { setFormValues } from "@/utils/formHelpers";
import { resetVideoPendingService } from "@/service/api/flowService";

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
    [],
  );

  const handleRecreate = async (id: string | number) => {
    try {
      if (!listFlowVideo) {
        throw new Error("Không có dữ liệu có sẵn!");
      }

      const video = listFlowVideo.find(
        (item) => Number(item.id) === Number(id),
      );

      if (!video) {
        throw new Error("Không tìm thấy video cần tạo lại!");
      }

      if (!video.prompt) {
        Notify({
          title: "Không có thông tin",
          description: "Video bị thiếu mô tả (prompt)",
          status: "error",
        });
        return;
      }

      console.log("🎬 [handleRecreate] video:", video);
      console.log("🧑 [handleRecreate] ownerId:", video.ownerId);
      console.log("🆔 [handleRecreate] videoId:", id);

      // 🔁 Reset video về Pending (GỬI ownerId)
      await resetVideoPendingService(
        Number(id),
        Number(video.ownerId),
      );

      // 📝 Nạp lại prompt vào form
      if (formVideo) {
        setFormValues(formVideo, {
          prompt: video.prompt,
        });
      }

      Notify({
        title: "Sẵn sàng tạo lại",
        description:
          "Yêu cầu tạo lại thành công.",
        status: "success",
      });
    } catch (error: any) {
      console.error("Lỗi tạo lại video:", error);

      Notify({
        title: "Có lỗi xảy ra",
        description:
          error?.response?.data?.message ||
          error.message ||
          "Không thể tạo lại video",
        status: "error",
      });
    }
  };


  const handleDelete = async (id: string | number) => {
    try {
      await dispatch(deleteFlowVideo(Number(id)));
      Notify({
        title: "Xóa video Flow thành công!",
        status: "success",
      });
    } catch (error) {
      console.error(`Lỗi xóa video: ${error}`);
      Notify({
        title: "Xóa video Flow lỗi!",
        status: "error",
      });
    }
  };

  const handleDeleteVideos = async () => {
    try {
      if (!listSelectedId || listSelectedId.length === 0) {
        Notify({
          title: "Chọn video cần xóa",
          description: "Hãy chọn video cần xóa",
          status: "warning",
        });
        return;
      }

      const promises = listSelectedId.map((id) => dispatch(deleteFlowVideo(Number(id))));
      await Promise.all(promises);

      Notify({
        title: "Xóa thành công",
        description: `Đã xóa ${listSelectedId.length} video.`,
        status: "success",
      });

      setListSelectedId([]);
      setSelectedCount(0);
    } catch (error) {
      console.error("❌ Lỗi xóa nhiều video:", error);
      Notify({
        title: "Lỗi xóa video",
        description: "Không thể xóa tất cả video đã chọn.",
        status: "error",
      });
    }
  };

  const handleReload = async (page?: number, limit?: number) => {
    try {
      await dispatch(
        getFlowVideo({
          page: page ?? 1,
          limit: limit ?? 10,
        }),
      );
    } catch (error) {
      console.error(`Lỗi reload video: ${error}`);
    }
  };

  return {
    handleSelectionChange,
    selectedCount,
    handleRecreate,
    handleDelete,
    handleDeleteVideos,
    handleReload,
  };
};
