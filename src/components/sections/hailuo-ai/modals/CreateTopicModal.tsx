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
import { useCreateTopic } from "@/hooks/hailou-ai/useCreateTopic";
import { ICreateTopic } from "../interface";

const CreateTopicModal: React.FC<ICreateTopic> = ({
  isOpen,
  onCancel,
  setOpen,
  formPrompt,
  handleOpenPromptModal,
  handleSetTopic,
}) => {
  const { formTopic, handleSubmit, loadHailuo } = useCreateTopic({
    formPrompt,
    onCancel,
    handleOpenPromptModal,
    handleSetTopic,
  });

  return (
    <CDialog
      open={isOpen}
      onOpenChange={setOpen}
      title="Tạo chủ đề mới"
      description="Tạo, lấy nhanh gợi ý bằng AI"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loadHailuo}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="outline"
            className="flex items-center gap-1 border-indigo-400 text-indigo-600 hover:bg-indigo-50"
            loading={loadHailuo}
          >
            ✨ Lấy gợi ý mô tả & từ khóa
          </Button>
        </>
      }
      onlyCloseByButton
      className="max-w-[700px]"
    >
      <Form {...formTopic}>
        <div className="space-y-4">
          <FormField
            control={formTopic.control}
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
            control={formTopic.control}
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

export default CreateTopicModal;
