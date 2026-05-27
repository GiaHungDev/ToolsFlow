import { Notify } from "@/lib/Notify";
import {
  removeAllPrompt,
  removePrompt,
  updatePromptContent,
} from "@/lib/redux/slices/flowSlice";
import { createFlowBatchService } from "@/service/api/flowService";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useCallback, useState } from "react";
import type { Scene } from "@/components/sections/flow-ai/modals/Results";

export const useListPromptModal = () => {
  const { listPrompt } = useAppSelector(
    (state) => state.flow
  );
  const dispatch = useAppDispatch();

  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>("");

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

  const resetSelections = () => {
    setEditingPrompt(null);
    setEditedContent("");
    dispatch(removeAllPrompt());
  };

  const createVideosFromScenes = async (scenes: Scene[], ownerId: number, images: any[] = [], projectName: string = "") => {
    try {
      const hasImages = images && images.length > 0;

      // Đóng gói mảng scenes
      const batchScenes = scenes.map((scene) => {
        const hasSceneImages = scene.images && scene.images.length > 0;
        let imagePathsObj: Record<string, string> | undefined = undefined;
        
        if (hasSceneImages) {
          imagePathsObj = {};
          let counter = 1;
          scene.images!.forEach((img) => {
            if (img && img.path) {
              imagePathsObj![`Image${counter}`] = img.path;
              counter++;
            }
          });
        }

        return {
          prompt: scene.prompt_text,
          sceneNumber: scene.scene_number,
          typeI2V: hasSceneImages ? "Ingredients to Video" : "Text to Video",
          ...(hasSceneImages ? { imagePaths: imagePathsObj } : {}),
        };
      });

      // Gửi 1 request duy nhất
      await createFlowBatchService(batchScenes, ownerId, images, projectName);

      Notify({
        title: "Đang xử lý yêu cầu tạo video",
        description: `Hệ thống đã nhận ${scenes.length} video.`,
        status: "success",
      });
    } catch (error) {
      console.error(error);
    }
  };

  return {
    listPrompt,
    loadFlow: false,
    editingPrompt,
    editedContent,
    setEditedContent,
    handleEditPrompt,
    handleSaveEdit,
    handleCancelEdit,
    handleDeletePrompt,
    resetSelections,
    createVideosFromScenes,
  };
};
