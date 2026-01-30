import { Notify } from "@/lib/Notify";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useCallback, useState } from "react";
import { useFormVideo } from "./useFormVideo";
import { setFormValues } from "@/utils/formHelpers";
import { deleteFlowVideo, getFlowVideo } from "@/lib/redux/slices/flowSlice";
import { getVeo3DownloadUrlService } from "@/service/api/flowService";
import { resetVideoPendingService } from "@/service/api/flowService";

interface UseTableActionsProp {
  formVideo: ReturnType<typeof useFormVideo>;
}

export const useTableActions = ({ formVideo }: UseTableActionsProp) => {
  const dispatch = useAppDispatch();

  const { listFlowVideo } = useAppSelector((state) => state.flow);
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [listSelectedId, setListSelectedId] = useState<(number | string)[]>([]);

  const pickUrl = (res: any): string | null => {
    if (!res) return null;
    if (typeof res.url === "string") return res.url;
    if (typeof res.url?.url === "string") return res.url.url; 
    return null;
  };

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


  const handleDownloadVideo = async (id: string | number) => {
    try {
      if (!listFlowVideo) return;

      const nId = Number(id);
      const check = listFlowVideo.find((item) => Number(item.id) === nId);

      if (!check || check.archiveStatus !== "Archived") {
        Notify({
          title: "Tải video lỗi",
          description: "Video chưa archive lên S3 hoặc chưa hoàn thành",
          status: "error",
        });
        return;
      }

      const res = await getVeo3DownloadUrlService(nId);
      const url = pickUrl(res);

      if (!url) {
        Notify({
          title: "Tải video lỗi",
          description: "BE không trả download url",
          status: "error",
        });
        return;
      }

      const a = document.createElement("a");
      a.href = url;
      a.download = `video_${nId}.mp4`; 
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error("❌ Lỗi tải video:", e);
      Notify({
        title: "Tải video lỗi",
        description: "Không thể tải video, vui lòng thử lại",
        status: "error",
      });
    }
  };

  const handleDownloadVideos = async () => {
    try {
      if (!listFlowVideo) throw new Error("Không có dữ liệu có sẵn!");

      if (!listSelectedId || listSelectedId.length === 0) {
        Notify({
          title: "Chọn video cần tải",
          description: "Hãy chọn video cần tải",
          status: "warning",
        });
        return;
      }

      for (const id of listSelectedId) {
        const nId = Number(id);
        const check = listFlowVideo.find((item) => Number(item.id) === nId);

        if (!check) {
          console.warn(`Không tìm thấy video có id = ${nId}`);
          continue;
        }

        if (check.archiveStatus !== "Archived") {
          Notify({
            title: "Tải video lỗi",
            description: `Video ${nId} chưa archive lên S3`,
            status: "error",
          });
          continue;
        }

        try {
          const res = await getVeo3DownloadUrlService(nId);
          const url = pickUrl(res);

          if (!url) {
            Notify({
              title: "Tải video lỗi",
              description: `BE không trả download url cho video ${nId}`,
              status: "error",
            });
            continue;
          }

          const a = document.createElement("a");
          a.href = url;
          a.download = `video_${nId}.mp4`;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // ✅ tránh browser chặn nhiều download cùng lúc
          await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
          console.error(`❌ Lỗi khi tải video ${nId}`, err);
          Notify({
            title: "Tải video lỗi",
            description: `Không thể tải video ${nId}`,
            status: "error",
          });
        }
      }
    } catch (error) {
      console.error("❌ Lỗi tải nhiều video:", error);
    }
  };


  // const handleRecreate = (id: string | number) => {
  //   try {
  //     if (!listFlowVideo) throw new Error("Không có dữ liệu có sẵn!");

  //     const check = listFlowVideo.find(
  //       (item) => Number(item.id) === Number(id),
  //     );

  //     if (!check) throw new Error("Không tìm thấy thông tin cần để tạo lại!");
  //     if (!check.prompt) {
  //       Notify({
  //         title: "Không có thông tin",
  //         description: "Video bị thiếu mô tả hoặc lỗi",
  //         status: "error",
  //       });
  //       throw new Error("Video không có prompt!");
  //     }

  //     if (formVideo) {
  //       setFormValues(formVideo, {
  //         prompt: check.prompt,
  //       });
  //       Notify({
  //         title: "Đã nạp dữ liệu",
  //         description:
  //           "Đã thêm mô tả video. Vui lòng chọn góc quay (nếu cần) và tải ảnh để tạo lại video.",
  //         status: "success",
  //       });
  //     }
  //   } catch (error) {
  //     console.error(`Lỗi tạo lại video: ${error}`);
  //   }
  // };

//   const handleRecreate = async (id: string | number) => {
//   try {
//     if (!listFlowVideo) {
//       throw new Error("Không có dữ liệu có sẵn!");
//     }

//     const video = listFlowVideo.find(
//       (item) => Number(item.id) === Number(id),
//     );

//     if (!video) {
//       throw new Error("Không tìm thấy video cần tạo lại!");
//     }

//     if (!video.prompt) {
//       Notify({
//         title: "Không có thông tin",
//         description: "Video bị thiếu mô tả (prompt)",
//         status: "error",
//       });
//       return;
//     }

//     // 🔁 Reset video về Pending
//     await resetVideoPendingService(Number(id));

//     // 📝 Nạp lại prompt vào form
//     if (formVideo) {
//       setFormValues(formVideo, {
//         prompt: video.prompt,
//       });
//     }

//     Notify({
//       title: "Sẵn sàng tạo lại",
//       description:
//         "Video đã được reset về Pending. Vui lòng chọn ảnh / góc quay và tạo lại video.",
//       status: "success",
//     });
//   } catch (error: any) {
//     console.error("Lỗi tạo lại video:", error);

//     Notify({
//       title: "Có lỗi xảy ra",
//       description:
//         error?.response?.data?.message || error.message || "Không thể tạo lại video",
//       status: "error",
//     });
//   }
// };

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
        }),
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
