"use client";

import { Label } from "@/components/ui/label";
import { Button } from "../../ui/button";
import { Separator } from "../../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import SelectTopicSection from "./SelectTopicSection";
import CreateVideoSection from "./CreateVideoSection";

const HailouAi = () => {
  return (
    <>
      <h5 className="mb-6 text-xs sm:text-sm lg:text-base font-semibold">Thể loại</h5>
      <Tabs defaultValue="i2v">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger
            value="i2v"
            className="w-full text-xs sm:text-xs lg:text-sm"
          >
            Image to Video
          </TabsTrigger>
          <TabsTrigger value="t2v" className="w-full">
            Text to video
          </TabsTrigger>
        </TabsList>
        <TabsContent value="i2v">
          <Separator className="my-3" />
          <h2 className="mb-6 text-xs sm:text-sm lg:text-base font-semibold">Tạo video</h2>
          <div className="grid w-full gap-4 mb-8">
            <div className="grid w-full gap-3">
              <Label htmlFor="select-topic">Chọn chủ đề đã có</Label>
              <SelectTopicSection />
            </div>
            <p className="text-center text-muted-foreground text-xs sm:text-xs lg:text-sm">
              Hoặc tạo mới chủ đề
            </p>
            <Button variant="secondary" className="w-full">
              Tạo chủ đề mới
            </Button>
          </div>
          <CreateVideoSection />
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
