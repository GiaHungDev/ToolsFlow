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
import { useCreatePromptT2V } from "@/hooks/hailou-ai/useCreatePromptT2V";
import { PromptT2VFormValues } from "@/hooks/hailou-ai/useFormPromptT2V";
import { UseFormReturn } from "react-hook-form";

interface CreatePromptT2VProp {
  isOpen: boolean;
  onCancel: () => void;
  setOpen: (open: boolean) => void;
  formPromptT2V: UseFormReturn<PromptT2VFormValues>;
  handleOpenListPromptModal: (state: boolean) => void;
}

const CreatePromptT2VModal: React.FC<CreatePromptT2VProp> = ({
  isOpen,
  onCancel,
  setOpen,
  formPromptT2V,
  handleOpenListPromptModal,
}) => {
  const { handleSubmit, loadHailuo } = useCreatePromptT2V(
    onCancel,
    formPromptT2V,
    handleOpenListPromptModal
  );

  return (
    <>
      <CDialog
        open={isOpen}
        onOpenChange={setOpen}
        title="Tạo Prompt"
        description="Hãy chỉnh sửa lại thông tin như chủ đề, mô tả, từ khóa và số lượng (nếu cần) để tạo prompt nhanh bằng AI"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={loadHailuo.loadcreatePromptT2V}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={loadHailuo.loadcreatePromptT2V}
              disabled={loadHailuo.loadcreatePromptT2V}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Tạo prompt
            </Button>
          </>
        }
        className="max-w-[700px]"
        onlyCloseByButton
      >
        <Form {...formPromptT2V}>
          <div className="space-y-4">
            <FormField
              control={formPromptT2V.control}
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
              control={formPromptT2V.control}
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
              control={formPromptT2V.control}
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
            <FormField
              control={formPromptT2V.control}
              name="quantity"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Số lượng</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? "" : Number(e.target.value)
                        )
                      }
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
          </div>
        </Form>
      </CDialog>
    </>
  );
};

export default CreatePromptT2VModal;
