import { CDialog } from "@/components/shared/CDialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTopicT2V } from "@/hooks/hailou-ai/useCreateTopicT2V";
import { PromptT2VFormValues } from "@/hooks/hailou-ai/useFormPromptT2V";
import { ITopic } from "@/types/hailuo";
import { UseFormReturn } from "react-hook-form";

interface CreateTopicT2VProp {
  isOpen: boolean;
  onCancelTopicT2V: () => void;
  setOpen: (open: boolean) => void;
  handleOpenT2VPromptModal: () => void;
  formPromptT2V: UseFormReturn<PromptT2VFormValues>;
  handleSetTopic: (topic: ITopic) => void;
}

const CreateTopicT2VModal: React.FC<CreateTopicT2VProp> = ({
  isOpen,
  onCancelTopicT2V,
  setOpen,
  formPromptT2V,
  handleOpenT2VPromptModal,
  handleSetTopic,
}) => {
  const { formTopicT2V, handleSubmit, loadHailuo } = useCreateTopicT2V(
    formPromptT2V,
    onCancelTopicT2V,
    handleOpenT2VPromptModal,
    handleSetTopic,
  );

  return (
    <CDialog
      open={isOpen}
      onOpenChange={setOpen}
      title="Tạo chủ đề mới"
      description="Tạo, lấy nhanh gợi ý bằng AI"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onCancelTopicT2V}
            disabled={loadHailuo.loadCreateTopic}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="outline"
            className="flex items-center gap-1 border-indigo-400 text-indigo-600 hover:bg-indigo-50"
            loading={loadHailuo.loadCreateTopic}
          >
            ✨ Lấy gợi ý mô tả & từ khóa
          </Button>
        </>
      }
      onlyCloseByButton
      className="max-w-[700px]"
    >
      <Form {...formTopicT2V}>
        <div className="space-y-4">
          <FormField
            control={formTopicT2V.control}
            name="title"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Chủ đề</FormLabel>
                <FormControl>
                  <Input placeholder="Nhập vào tiêu đề chủ đề" {...field} />
                </FormControl>
                {fieldState.error && (
                  <p className="text-sm text-red-500 mt-1">
                    {fieldState.error.message}
                  </p>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={formTopicT2V.control}
            name="prompt"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Mô tả</FormLabel>
                <FormControl>
                  <Textarea
                    className="h-32"
                    placeholder="Nhập yêu cầu liên quan đến chủ đề, AI sẽ tạo mô tả và từ khóa."
                    {...field}
                  />
                </FormControl>
                {fieldState.error && (
                  <p className="text-sm text-red-500 mt-1">
                    {fieldState.error.message}
                  </p>
                )}
              </FormItem>
            )}
          />
          <span className="text-gray-500">
            * Sau khi lấy gợi ý, bạn có thể chỉnh sửa mô tả và từ khoá trước khi
            tạo Prompt.
          </span>
        </div>
      </Form>
    </CDialog>
  );
};

export default CreateTopicT2VModal;
