import { Notify } from "@/lib/Notify";
import {
  createHailuoT2V,
  removeAllPrompt,
  removePrompt,
  removePromptCameraMovement,
  updatePromptCameraMovement,
  updatePromptContent,
} from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useCallback, useState } from "react";
import { useCamMotion } from "./useCamMotion";

interface UseListPromptProp {
  handleCloseListPromptModal: () => void;
}

export const useListPromptModal = ({
  handleCloseListPromptModal,
}: UseListPromptProp) => {
  const { listPrompt, chooseVideoTopic, loadHailuo } = useAppSelector(
    (state) => state.hailuo
  );
  const dispatch = useAppDispatch();

  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");
  const [openCamMotion, setOpenCamMotion] = useState(false);
  const [camMotionMode, setCamMotionMode] = useState<"single" | "all" | null>(
    null
  );
  const [editingPromptForCamera, setEditingPromptForCamera] = useState<
    string | null
  >(null);

  const handleEditPrompt = useCallback((promptId: string, content: string) => {
    setEditingPrompt(promptId);
    setEditedContent(content);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingPrompt && editedContent.trim()) {
      dispatch(
        updatePromptContent({
          id: editingPrompt,
          content: editedContent.trim(),
        })
      );
      setEditingPrompt(null);
      setEditedContent("");
    }
  }, [editingPrompt, editedContent, dispatch]);

  const handleCancelEdit = () => {
    setEditingPrompt(null);
    setEditedContent("");
  };

  const handleDeletePrompt = useCallback(
    (promptId: string) => {
      dispatch(removePrompt(promptId));
    },
    [dispatch]
  );

  const fakeForm = {
    getValues: () => ({ description: "" }),
    setValue: () => {},
  } as any;

  const camMotion = useCamMotion(fakeForm);

  const handleOpenCamMotionForAll = useCallback(() => {
    setCamMotionMode("all");
    setOpenCamMotion(true);
  }, []);

  const handleOpenCamMotionForSingle = useCallback((promptId: string) => {
    setCamMotionMode("single");
    setEditingPromptForCamera(promptId);
    setOpenCamMotion(true);
  }, []);

  const handleCamMotionSubmit = useCallback(() => {
    if (camMotion.selectedPreset) {
      const targetIds =
        camMotionMode === "all"
          ? listPrompt.map((p) => p.id)
          : editingPromptForCamera
          ? [editingPromptForCamera]
          : [];

      if (targetIds.length > 0) {
        dispatch(
          updatePromptCameraMovement({
            ids: targetIds,
            cameraMovement: camMotion.selectedPreset.promptKey,
          })
        );
        Notify({
          title: "Góc quay đã được chọn",
          description: `"${targetIds.length}" Góc quay đã được thêm vào mô tả video.`,
          status: "success",
        });
      }
    }

    setOpenCamMotion(false);
    setCamMotionMode(null);
    setEditingPromptForCamera(null);
    camMotion.setSelectedPreset(null);
  }, [
    camMotion,
    // camMotion.selectedPreset,
    camMotionMode,
    editingPromptForCamera,
    listPrompt,
    dispatch,
  ]);

  const handleCamMotionCancel = useCallback(() => {
    setOpenCamMotion(false);
    setCamMotionMode(null);
    setEditingPromptForCamera(null);
    camMotion.setSelectedPreset(null);
  }, [camMotion]);

  const resetSelections = () => {
    setEditingPrompt(null);
    setEditedContent("");
    handleCamMotionCancel();
    dispatch(removeAllPrompt());
  };

  const handleRemoveCameraMovement = useCallback(
    (promptId: string) => {
      dispatch(removePromptCameraMovement({ ids: [promptId] }));
      Notify({
        title: "Đã xóa góc quay",
        description: "Góc quay vừa được loại bỏ khỏi mô tả video.",
        status: "success",
      });
    },
    [dispatch]
  );

  const handleRemoveAllCameraMovement = useCallback(() => {
    const allIds = listPrompt.map((p) => p.id);
    dispatch(removePromptCameraMovement({ ids: allIds }));
    Notify({
      title: "Đã xóa góc quay",
      description: `"${allIds.length}" Góc quay vừa được loại bỏ khỏi mô tả video.`,
      status: "success",
    });
  }, [dispatch, listPrompt]);

  const handleCreateVideoT2V = async () => {
    try {
      if (!chooseVideoTopic)
        throw new Error("Selected topic for creating video not found.");

      for (const item of listPrompt) {
        const payload = {
          model: "T2V-01-Director",
          prompt: item.content,
          topic: chooseVideoTopic.id,
        };

        await dispatch(createHailuoT2V({ ...payload })).unwrap();
      }
      resetSelections();
      handleCloseListPromptModal();
      Notify({
        title: "Đang xử lý yêu cầu tạo video",
        description: `Hệ thống đã nhận thông tin tạo "${listPrompt.length}" và đưa vào hàng chờ.`,
        status: "success",
      });
    } catch (error) {
      console.error(error);
    }
  };

  return {
    listPrompt,
    loadHailuo: loadHailuo.loadCreateT2V,
    editingPrompt,
    editedContent,
    setEditedContent,
    handleEditPrompt,
    handleSaveEdit,
    handleCancelEdit,
    handleDeletePrompt,
    resetSelections,
    openCamMotion,
    camMotion,
    handleOpenCamMotionForAll,
    handleOpenCamMotionForSingle,
    handleCamMotionSubmit,
    handleCamMotionCancel,
    handleRemoveCameraMovement,
    handleRemoveAllCameraMovement,
    handleCreateVideoT2V,
  };
};
