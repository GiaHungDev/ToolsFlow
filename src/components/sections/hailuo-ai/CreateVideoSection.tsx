"use client";

import { FileUploadComponent } from "@/components/shared/CUpload";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useCreateVideoForm } from "@/hooks/hailou-ai/useCreateVideoForm";

const CreateVideoSection = () => {
  const { form, handleSubmit } = useCreateVideoForm();

  return (
    <>
      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-8">
          <FormField
            control={form.control}
            name="videoDescription"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Mô tả video</FormLabel>
                <FormControl>
                  <Textarea
                    className="h-32"
                    placeholder="Nhập mô tả video."
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
            control={form.control}
            name="images"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Upload ảnh</FormLabel>
                <FormControl>
                  <FileUploadComponent
                    maxFiles={5}
                    maxFileSize={20}
                    title="Kéo thả ảnh hoặc click để chọn ảnh"
                    acceptedTypes={[".jpg", ".jpeg", ".png", ".gif", ".webp"]}
                    onFilesChange={field.onChange}
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
          <Button variant="secondary" className="w-full" type="submit">
            Tạo video
          </Button>
        </form>
      </Form>
    </>
  );
};

export default CreateVideoSection;
