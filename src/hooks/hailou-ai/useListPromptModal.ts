import { useState, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/lib/redux/store";
import {
  removePrompt,
  removePromptCameraMovement,
  updatePromptCameraMovement,
  updatePromptContent,
} from "@/lib/redux/slices/hailuoSlice";
import { useCamMotion } from "./useCamMotion";

export const useListPromptModal = () => {
  const { listPrompt, loadHailuo } = useAppSelector((state) => state.hailuo);
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

  const handleCancelEdit = useCallback(() => {
    setEditingPrompt(null);
    setEditedContent("");
  }, []);

  const handleDeletePrompt = useCallback(
    (promptId: string) => {
      dispatch(removePrompt(promptId));
    },
    [dispatch]
  );

  const resetSelections = useCallback(() => {
    setEditingPrompt(null);
    setEditedContent("");
  }, []);

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

  const handleRemoveCameraMovement = useCallback(
    (promptId: string) => {
      dispatch(removePromptCameraMovement({ ids: [promptId] }));
    },
    [dispatch]
  );

  const handleRemoveAllCameraMovement = useCallback(() => {
    const allIds = listPrompt.map((p) => p.id);
    dispatch(removePromptCameraMovement({ ids: allIds }));
  }, [dispatch, listPrompt]);

  return {
    listPrompt,
    loadHailuo: loadHailuo.loadCreateVideo,
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
  };
};
