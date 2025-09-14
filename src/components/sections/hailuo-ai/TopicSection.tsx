import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import SelectTopicSection from "./SelectTopicSection";

interface TopicSectionProps {
  listTopic: any[];
  open: boolean;
  setOpen: (val: boolean) => void;
  selected: any;
  topic: any;
  handleSetTopic: (topic: any) => void;
  handleSelectTopic: (topic: any) => void;
  handleOpenTopicModal: () => void;
}

const TopicSection: React.FC<TopicSectionProps> = ({
  listTopic,
  open,
  setOpen,
  selected,
  topic,
  handleSetTopic,
  handleSelectTopic,
  handleOpenTopicModal,
}) => {
  return (
    <div className="grid w-full gap-3 sm:gap-4 mb-6 sm:mb-6">
      <div className="grid w-full gap-2 sm:gap-2.5">
        <Label
          htmlFor="select-topic"
          className="text-[6px] xs:text-[10px] sm:text-xs lg:text-sm"
        >
          Chọn chủ đề đã có
        </Label>
        <SelectTopicSection
          handleSetTopic={handleSetTopic}
          handleSelect={handleSelectTopic}
          listTopic={listTopic}
          open={open}
          setOpen={setOpen}
          selected={selected}
          topic={topic}
        />
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
  );
};

export default TopicSection;
