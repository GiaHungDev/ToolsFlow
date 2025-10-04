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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CreateVideoFormValues } from "@/hooks/flow-ai/useFormVideo";
import { Clapperboard, Video } from "lucide-react";
import { UseFormReturn } from "react-hook-form";

interface CreateVideoSectionProps {
  formVideo: UseFormReturn<CreateVideoFormValues>;
  handleSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  loading: boolean;
  handleOpenCamMotion: () => void;
}

const CreateVideoSection: React.FC<CreateVideoSectionProps> = ({
  formVideo,
  handleSubmit,
  loading,
  handleOpenCamMotion,
}) => {
  return (
    <>
      <Form {...formVideo}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormField
            control={formVideo.control}
            name="description"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Mô tả video</FormLabel>
                <FormControl>
                  <Textarea
                    className="min-h-24"
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
          <div className="grid w-full gap-2 sm:gap-2.5">
            <Label
              htmlFor="select-topic"
              className="text-[6px] xs:text-[10px] sm:text-xs lg:text-sm"
            >
              Chọn góc quay
            </Label>
            <Button
              type="button"
              variant={"secondary"}
              onClick={handleOpenCamMotion}
            >
              <Video /> Chọn góc quay
            </Button>
          </div>
          <FormField
            control={formVideo.control}
            name="images"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Upload ảnh</FormLabel>
                <FormControl>
                  <FileUploadComponent
                    value={field.value || []}
                    maxFiles={1}
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
          <Button
            variant="secondary"
            className="w-full"
            type="submit"
            loading={loading}
          >
            <Clapperboard />
            Tạo video
          </Button>
        </form>
      </Form>
    </>
  );
};

export default CreateVideoSection;
