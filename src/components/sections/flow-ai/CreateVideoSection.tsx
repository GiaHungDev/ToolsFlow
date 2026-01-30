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
import { Clapperboard } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface CreateVideoSectionProps {
  formVideo: UseFormReturn<CreateVideoFormValues>;
  handleSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  loading: boolean;
}

const CreateVideoSection: React.FC<CreateVideoSectionProps> = ({
  formVideo,
  handleSubmit,
  loading,
}) => {
  return (
    <>
      <Form {...formVideo}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormField
            control={formVideo.control}
            name="prompt"
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

          {/* 🆕 Lựa chọn kiểu tạo video */}
          <FormField
            control={formVideo.control}
            name="videoType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Chọn kiểu tạo video</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    value={field.value}
                    className="flex gap-4 mt-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Frames to Video" id="frames" />
                      <Label htmlFor="frames">Frames to Video</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="Ingredients to Video"
                        id="ingredients"
                      />
                      <Label htmlFor="ingredients">Ingredients to Video</Label>
                    </div>
                  </RadioGroup>
                </FormControl>
              </FormItem>
            )}
          />

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

