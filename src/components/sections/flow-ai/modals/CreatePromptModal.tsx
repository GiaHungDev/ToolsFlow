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
import { useCreatePrompt } from "@/hooks/flow-ai/useCreatePrompt";
import { ICreatePrompt } from "../interface";

const CreatePromptModal: React.FC<ICreatePrompt> = ({
  isOpen,
  onCancel,
  setOpen,
  formVideo,
  formPrompt,
}) => {
  const { handleSubmit, loadFlow } = useCreatePrompt(
    { onCancel, formVideo },
    formPrompt
  );

  return (
    <>
      <CDialog
        open={isOpen}
        onOpenChange={setOpen}
        title="Tạo Prompt"
        description="Hãy chỉnh sửa thông tin như chủ đề, mô tả và từ khóa (nếu cần) để tạo prompt nhanh bằng AI"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={loadFlow.loadCreatePrompt}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={loadFlow.loadCreatePrompt}
              disabled={loadFlow.loadCreatePrompt}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Tạo prompt
            </Button>
          </>
        }
        className="max-w-[700px]"
        onlyCloseByButton
      >
        <Form {...formPrompt}>
          <div className="space-y-4">
            <FormField
              control={formPrompt.control}
              name="title"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Chủ đề</FormLabel>
                  <FormControl>
                    <Input placeholder="Nhập vào chủ đề" {...field} />
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
              control={formPrompt.control}
              name="description"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Mô tả</FormLabel>
                  <FormControl>
                    <Textarea
                      className="h-32"
                      placeholder="Nhập mô tả chủ đề."
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
            <FormField
              control={formPrompt.control}
              name="keywords"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Từ khóa</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Nhập từ khóa." {...field} />
                  </FormControl>
                  {fieldState.error && (
                    <p className="text-sm text-red-500 mt-1">
                      {fieldState.error.message}
                    </p>
                  )}
                </FormItem>
              )}
            />
          </div>
        </Form>
      </CDialog>
    </>
  );
};

export default CreatePromptModal;
