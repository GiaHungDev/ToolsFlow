"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";

const formSchema = z.object({
  username: z.string(),
});

const HailouAi = () => {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState([
    "Kinh tế",
    "Chính trị",
    "Công nghệ",
    "Giải trí",
    "Thể thao",
    "Tết nguyên đán",
    "Trung thu",
    "khoa học",
    "test",
  ]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [topicToDelete, setTopicToDelete] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
    },
  });

  // 2. Define a submit handler.
  function onSubmit(values: z.infer<typeof formSchema>) {
    // Do something with the form values.
    // ✅ This will be type-safe and validated.
    console.log(values);
  }

  const handleDeleteTitle = (topic: string) => {
    setTopics(topics.filter((t) => t !== topic));
    setDeleteDialogOpen(false);
    // Nếu topic đang được chọn thì clear
    if (form.getValues("username") === topic) {
      form.setValue("username", "");
    }
  };

  const handleFetchOldPrompt = (value: string) => {
    console.log("Fetch old prompt for:", value);
    // Logic để fetch prompt cũ
  };

  return (
    <>
      <h4>Thể loại</h4>
      <Tabs defaultValue="i2v">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="i2v" className="w-full">
            Image to Video
          </TabsTrigger>
          <TabsTrigger value="t2v" className="w-full">
            Text to video
          </TabsTrigger>
        </TabsList>
        <TabsContent value="i2v">
          <Separator className="my-3" />
          <div className="flex justify-between items-center mb-3">
            <h2>Tạo Prompt</h2>
            <Button variant="outline" size="sm">
              Clear
            </Button>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <>
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Tạo chủ đề mới</FormLabel>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => console.log("Thêm chủ đề")}
                        >
                          + Thêm chủ đề bằng AI
                        </Button>
                      </div>
                      <FormControl>
                        <Input placeholder="Nhập hoặc chọn chủ đề" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>

                    <FormItem>
                      <FormLabel>Mô tả chi tiết</FormLabel>
                      <FormControl>
                        <Input placeholder="Nhập hoặc chọn chủ đề" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  </>
                )}
              />
              <Button type="submit">Submit</Button>
            </form>
          </Form>
        </TabsContent>
        <TabsContent value="t2v">
          <Separator className="my-3" />
          Change your password here.
        </TabsContent>
      </Tabs>
    </>
  );
};

export default HailouAi;
