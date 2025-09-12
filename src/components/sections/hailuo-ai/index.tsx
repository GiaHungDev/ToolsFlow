"use client";

import { Label } from "@/components/ui/label";
import { useCreateVideo } from "@/hooks/hailou-ai/useCreateVideo";
import { useCreateVideoForm } from "@/hooks/hailou-ai/useCreateVideoForm";
import { useSelectTopic } from "@/hooks/hailou-ai/useSelectTopic";
import { Button } from "../../ui/button";
import { Separator } from "../../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import CreateVideoSection from "./CreateVideoSection";
import SelectTopicSection from "./SelectTopicSection";
import CreatePromptModal from "./modals/CreatePromptModal";
import CreateTopicModal from "./modals/CreateTopicModal";
import { useClear } from "@/hooks/hailou-ai/useClear";
import { useCamMotion } from "@/hooks/hailou-ai/useCamMotion";
import CamMotionModal from "./modals/CamMotionModal";
import { useFormVideo } from "@/hooks/hailou-ai/useFormVideo";
import { useFormPrompt } from "@/hooks/hailou-ai/useFormPrompt";

interface HailouAIProp {
  formVideo: ReturnType<typeof useFormVideo>;
}

const HailouAi: React.FC<HailouAIProp> = ({ formVideo }) => {
  const formPrompt = useFormPrompt();

  const {
    openTopicModal,
    setOpenTopicModal,
    handleOpenTopicModal,
    handleCancelTopicModal,
    openPromptModal,
    setOpenPromptModal,
    handleOpenPromptModal,
    handleCancelPromptModal,
  } = useCreateVideo();

  // hàm select topic đã có
  const selectTopicHook = useSelectTopic({ handleOpenPromptModal, formPrompt });
  const { handleSetTopic } = selectTopicHook;

  // hàm tạo video
  const { handleSubmit, loadHailuo } = useCreateVideoForm({
    formVideo,
  });

  // hàm chọn góc quay
  const {
    selectedPreset,
    setHoveredPreset,
    hoveredPreset,
    setOpenCamMotion,
    openCamMotion,
    handleOpenCamMotion,
    handleCancelCamMotion,
    handlePresetSelect,
    handleSubmitCamMotion,
    videoRefs,
    handleMouseEnter,
    handleMouseLeave,
    setSelectedPreset,
  } = useCamMotion(formVideo);

  // Hàm clear
  const { handleClearCreateVideo } = useClear({
    handleSetTopic,
    formVideo,
    setSelectedPreset,
  });

  return (
    <>
      <h5 className="mb-3 sm:mb-4 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold">
        Thể loại
      </h5>
      <Tabs defaultValue="i2v">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger
            value="i2v"
            className="w-full text-[6px] xs:text-[10px] sm:text-xs lg:text-sm px-1 sm:px-2 lg:px-3"
          >
            <span className="truncate">Image to Video</span>
          </TabsTrigger>
          <TabsTrigger
            value="t2v"
            className="w-full text-[6px] xs:text-[10px] sm:text-xs lg:text-sm px-1 sm:px-2 lg:px-3"
          >
            <span className="truncate">Text to Video</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="i2v" className="mt-3 sm:mt-4">
          <Separator className="my-2 sm:my-3" />
          <div className="flex justify-between">
            <h2 className="mb-3 sm:mb-4 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold">
              Tạo video
            </h2>
            <Button variant="ghost" onClick={handleClearCreateVideo}>
              Clear
            </Button>
          </div>
          <div className="grid w-full gap-3 sm:gap-4 mb-6 sm:mb-6">
            <div className="grid w-full gap-2 sm:gap-2.5">
              <Label
                htmlFor="select-topic"
                className="text-[6px] xs:text-[10px] sm:text-xs lg:text-sm"
              >
                Chọn chủ đề đã có
              </Label>
              <SelectTopicSection selectTopicHook={selectTopicHook} />
            </div>
            <p className="text-center text-muted-foreground text-[6px] xs:text-[10px] sm:text-xs lg:text-sm px-2">
              Hoặc tạo mới chủ đề
            </p>
            <Button
              variant="secondary"
              className="w-full text-[6px] xs:text-[10px] sm:text-xs lg:text-sm"
              onClick={handleOpenTopicModal}
            >
              Tạo chủ đề mới
            </Button>
          </div>
          <CreateVideoSection
            formVideo={formVideo}
            handleSubmit={handleSubmit}
            loading={loadHailuo.loadCreateVideo}
            handleOpenCamMotion={handleOpenCamMotion}
          />
        </TabsContent>
        <TabsContent value="t2v" className="mt-3 sm:mt-4">
          <Separator className="my-2 sm:my-3" />
          <div className="text-xs sm:text-sm lg:text-base text-muted-foreground">
            Change your password here.
          </div>
        </TabsContent>
      </Tabs>
      <CreatePromptModal
        isOpen={openPromptModal}
        onCancel={handleCancelPromptModal}
        setOpen={setOpenPromptModal}
        formVideo={formVideo}
        formPrompt={formPrompt}
      />
      <CreateTopicModal
        isOpen={openTopicModal}
        setOpen={setOpenTopicModal}
        onCancel={handleCancelTopicModal}
        formPrompt={formPrompt}
        handleOpenPromptModal={handleOpenPromptModal}
        handleSetTopic={handleSetTopic}
      />
      <CamMotionModal
        handleCancelCamMotion={handleCancelCamMotion}
        handlePresetSelect={handlePresetSelect}
        handleSubmit={handleSubmitCamMotion}
        hoveredPreset={hoveredPreset}
        openCamMotion={openCamMotion}
        selectedPreset={selectedPreset}
        setHoveredPreset={setHoveredPreset}
        setOpenCamMotion={setOpenCamMotion}
        videoRefs={videoRefs}
        handleMouseEnter={handleMouseEnter}
        handleMouseLeave={handleMouseLeave}
      />
    </>
  );
};

export default HailouAi;
