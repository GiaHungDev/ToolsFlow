import { CDialog } from "@/components/shared/CDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useListPromptModal } from "@/hooks/flow-ai/useListPromptModal";
import { Camera, CameraOff, Trash2 } from "lucide-react";
import CamMotionModal from "./CamMotionModal";

interface ListPromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handleCloseListPromptModal: () => void;
}

const PromptItem = ({
  prompt,
  isEditing,
  editedContent,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onContentChange,
  onOpenCameraMotion,
  onRemoveCameraMotion,
}: {
  prompt: any;
  isEditing: boolean;
  editedContent: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onContentChange: (value: string) => void;
  onOpenCameraMotion: (promptId: string) => void;
  onRemoveCameraMotion: (promptId: string) => void;
}) => {
  const hasCameraMovement = prompt.content.includes("Camera movement:");

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        {isEditing ? (
          <div className="flex-1">
            <Textarea
              value={editedContent}
              onChange={(e) => onContentChange(e.target.value)}
              className="min-h-[100px] resize-none"
              placeholder="Nhập nội dung prompt..."
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                onClick={onSave}
                disabled={!editedContent.trim()}
              >
                Lưu
              </Button>
              <Button size="sm" variant="outline" onClick={onCancel}>
                Hủy
              </Button>
            </div>
          </div>
        ) : (
          <Textarea
            value={prompt.content}
            readOnly
            className="flex-1 min-h-[100px] resize-none bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={onEdit}
          />
        )}

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenCameraMotion(prompt.id)}
            className="flex items-center gap-2 min-w-[140px] border-blue-500 text-blue-600 hover:bg-blue-50"
          >
            <Camera className="h-4 w-4" />
            Chọn góc quay
          </Button>

          {hasCameraMovement && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRemoveCameraMotion(prompt.id)}
              className="flex items-center gap-2 border-slate-700 text-slate-600 hover:bg-slate-50"
            >
              <CameraOff className="h-4 w-4" />
              Hủy góc quay
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="flex items-center gap-2 min-w-[140px] border-red-600 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Xóa
          </Button>
        </div>
      </div>
    </div>
  );
};

const ListPromptModal: React.FC<ListPromptModalProps> = ({
  open,
  onOpenChange,
  handleCloseListPromptModal,
}) => {
  const {
    listPrompt,
    loadFlow,
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
  } = useListPromptModal({ handleCloseListPromptModal });

  const handleCancel = () => {
    resetSelections();
    onOpenChange(false);
  };

  const hasAnyCameraMovement = listPrompt.some((p) =>
    p.content.includes("Camera movement:")
  );

  return (
    <>
      <CDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Danh sách Prompt đã tạo"
        description=""
        footer={
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleOpenCamMotionForAll}
                className="flex items-center gap-2"
                disabled={loadFlow}
              >
                <Camera className="h-4 w-4" />
                Chọn góc quay cho tất cả
              </Button>
              {hasAnyCameraMovement && (
                <Button
                  variant="outline"
                  onClick={handleRemoveAllCameraMovement}
                  className="flex items-center gap-2 border-slate-700 text-slate-600 hover:bg-slate-50"
                  disabled={loadFlow}
                >
                  <CameraOff className="h-4 w-4" />
                  Hủy góc quay tất cả
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={handleCancel}
                disabled={loadFlow}
              >
                Hủy
              </Button>
              <Button
                onClick={handleCreateVideoT2V}
                className="text-white bg-blue-600 hover:bg-blue-400"
                disabled={loadFlow}
              >
                Tạo video
              </Button>
            </div>
          </div>
        }
        className="max-w-[900px]"
        onlyCloseByButton
      >
        <div
          className={`space-y-4 max-h-[60vh] overflow-y-auto ${
            loadFlow ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          {listPrompt.map((prompt) => (
            <PromptItem
              key={prompt.id}
              prompt={prompt}
              isEditing={editingPrompt === prompt.id}
              editedContent={editedContent}
              onEdit={() => handleEditPrompt(prompt.id, prompt.content)}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
              onDelete={() => handleDeletePrompt(prompt.id)}
              onContentChange={setEditedContent}
              onOpenCameraMotion={() => handleOpenCamMotionForSingle(prompt.id)}
              onRemoveCameraMotion={() => handleRemoveCameraMovement(prompt.id)}
            />
          ))}

          {listPrompt.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Chưa có prompt nào được tạo
            </div>
          )}
        </div>
      </CDialog>
      <CamMotionModal
        handleCancelCamMotion={handleCamMotionCancel}
        handlePresetSelect={camMotion.handlePresetSelect}
        handleSubmit={handleCamMotionSubmit}
        hoveredPreset={camMotion.hoveredPreset}
        openCamMotion={openCamMotion}
        selectedPreset={camMotion.selectedPreset}
        setHoveredPreset={camMotion.setHoveredPreset}
        setOpenCamMotion={camMotion.setOpenCamMotion}
        videoRefs={camMotion.videoRefs}
        handleMouseEnter={camMotion.handleMouseEnter}
        handleMouseLeave={camMotion.handleMouseLeave}
      />
    </>
  );
};

export default ListPromptModal;
