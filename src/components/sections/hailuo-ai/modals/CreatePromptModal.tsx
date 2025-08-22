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
import { useCreatePrompt } from "@/hooks/hailou-ai/useCreatePrompt";
import { ICreateTopic } from "../interface";
import CreateTopicModal from "./CreateTopicModal";

const CreatePromptModal: React.FC<ICreateTopic> = ({
  isOpen,
  onCancel,
  setOpen,
}) => {
  const {
    formPrompt,
    handleSubmit,
    cancelTopicModal,
    setIsOpenTopicModal,
    isOpenTopicModal,
  } = useCreatePrompt();

  return (
    <>
      <CDialog
        open={isOpen}
        onOpenChange={setOpen}
        title="Tạo Prompt"
        description="Hãy nhập thông tin như chủ đề, mô tả và từ khóa để tạo prompt hoặc có thể tạo nhanh bằng AI"
        footer={
          <>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={() => setIsOpenTopicModal(true)}
              variant="outline"
              className="flex items-center gap-1 border-indigo-400 text-indigo-600 hover:bg-indigo-50"
            >
              ✨ Tạo mới chủ đề bằng AI
            </Button>
            <Button
              onClick={handleSubmit}
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
      <CreateTopicModal
        isOpen={isOpenTopicModal}
        setOpen={setIsOpenTopicModal}
        onCancel={cancelTopicModal}
        formPrompt={formPrompt}
      />
    </>
  );
};

export default CreatePromptModal;
