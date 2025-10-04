"use client";

import { useCamMotion } from "@/hooks/flow-ai/useCamMotion";
import { useClear } from "@/hooks/flow-ai/useClear";
import { useCreateVideo } from "@/hooks/flow-ai/useCreateVideo";
import { useCreateVideoForm } from "@/hooks/flow-ai/useCreateVideoForm";
import { useFormPrompt } from "@/hooks/flow-ai/useFormPrompt";
import { useFormVideo } from "@/hooks/flow-ai/useFormVideo";
import { useSelectTopic } from "@/hooks/flow-ai/useSelectTopic";
import { Button } from "../../ui/button";
import { Separator } from "../../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import CreateVideoSection from "./CreateVideoSection";
import TopicSection from "./TopicSection";
import CamMotionModal from "./modals/CamMotionModal";
import CreatePromptModal from "./modals/CreatePromptModal";
import CreateTopicModal from "./modals/CreateTopicModal";
import CreatePromptT2VModal from "./modals/CreatePromptT2vModal";
import { useFormPromptT2V } from "@/hooks/flow-ai/useFormPromptT2V";
import ListPromptModal from "./modals/ListPromptModal";
import CreateTopicT2VModal from "./modals/CreateTopicT2VModal";

interface FlowAIProp {
  formVideo: ReturnType<typeof useFormVideo>;
}

const FlowAI: React.FC<FlowAIProp> = ({ formVideo }) => {
  const formPrompt = useFormPrompt();
  const formPromptT2V = useFormPromptT2V();

  // Hook chính của FlowAI
  const {
    openTopicModal,
    setOpenTopicModal,
    handleOpenTopicModal,
    handleCancelTopicModal,
    openPromptModal,
    setOpenPromptModal,
    handleOpenPromptModal,
    handleCancelPromptModal,
    handleOpenT2VPromptModal,
    handleCloseT2VPromptModal,
    openT2VPromptModal,
    setOpenT2VPromptModal,
    openListPromptModal,
    setOpenListPromptModal,
    handleOpenListPromptModal,
    handleCloseListPromptModal,
    openTopicT2VModal,
    setOpenTopicT2VModal,
    handleOpenTopicT2VModal,
    handleCloseTopicT2VModal,
  } = useCreateVideo();

  // hook select topic đã có
  const {
    listTopic,
    setOpen,
    open,
    selected,
    handleSetTopic,
    topic,
    handleSelectTopicI2V,
    handleSelectTopicT2V,
  } = useSelectTopic({
    handleOpenPromptModal,
    handleOpenT2VPromptModal,
    formPrompt,
    formPromptT2V,
  });

  // hook tạo video cuối cùng
  const { handleSubmit, loadFlow } = useCreateVideoForm({
    formVideo,
  });

  // hook chọn góc quay
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

  // hook clear
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

          <TopicSection
            listTopic={listTopic}
            open={open}
            setOpen={setOpen}
            selected={selected}
            topic={topic}
            handleSetTopic={handleSetTopic}
            handleSelectTopic={handleSelectTopicI2V}
            handleOpenTopicModal={handleOpenTopicModal}
          />

          <CreateVideoSection
            formVideo={formVideo}
            handleSubmit={handleSubmit}
            loading={loadFlow.loadCreateVideo}
            handleOpenCamMotion={handleOpenCamMotion}
          />
        </TabsContent>
        {/* //////////////////////////////////////////////////////////////////////////////////// */}
        <TabsContent value="t2v" className="mt-3 sm:mt-4">
          <Separator className="my-2 sm:my-3" />
          <div className="flex justify-between">
            <h2 className="mb-3 sm:mb-4 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold">
              Tạo video
            </h2>
            <Button variant="ghost" onClick={handleClearCreateVideo}>
              Clear
            </Button>
          </div>

          <TopicSection
            listTopic={listTopic}
            open={open}
            setOpen={setOpen}
            selected={selected}
            topic={topic}
            handleSetTopic={handleSetTopic}
            handleSelectTopic={handleSelectTopicT2V}
            handleOpenTopicModal={handleOpenTopicT2VModal}
          />
        </TabsContent>
      </Tabs>
      {/* ---------------------------------- Modal --------------------------------------- */}
      <CreatePromptModal
        isOpen={openPromptModal}
        onCancel={handleCancelPromptModal}
        setOpen={setOpenPromptModal}
        formVideo={formVideo}
        formPrompt={formPrompt}
      />
      <CreateTopicT2VModal
        isOpen={openTopicT2VModal}
        setOpen={setOpenTopicT2VModal}
        onCancelTopicT2V={handleCloseTopicT2VModal}
        formPromptT2V={formPromptT2V}
        handleOpenT2VPromptModal={handleOpenT2VPromptModal}
        handleSetTopic={handleSetTopic}
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
      <CreatePromptT2VModal
        formPromptT2V={formPromptT2V}
        isOpen={openT2VPromptModal}
        onCancel={handleCloseT2VPromptModal}
        setOpen={setOpenT2VPromptModal}
        handleOpenListPromptModal={handleOpenListPromptModal}
      />
      <ListPromptModal
        open={openListPromptModal}
        onOpenChange={setOpenListPromptModal}
        handleCloseListPromptModal={handleCloseListPromptModal}
      />
    </>
  );
};

export default FlowAI;
