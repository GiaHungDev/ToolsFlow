"use client";

import { Label } from "@/components/ui/label";
import React from "react";
import { Button } from "../../ui/button";
import { Separator } from "../../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import CreateVideoSection from "./CreateVideoSection";
import SelectTopicSection from "./SelectTopicSection";
import CreateTopicModal from "./modals/CreatePromptModal";

const HailouAi = () => {
  const [open, setOpen] = React.useState(false);

  const handleOpent = () => {
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  return (
    <>
      <h5 className="mb-3 sm:mb-4 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold">
        Thể loại
      </h5>
      <Tabs defaultValue="i2v">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger
            value="i2v"
            className="w-full text-[6px] xs:text-[10px] sm:text-xs lg:text-sm px-1 sm:px-2 lg:px-3"
          >
            <span className="truncate">Image to Video</span>
          </TabsTrigger>
          <TabsTrigger
            value="t2v"
            className="w-full text-[6px] xs:text-[10px] sm:text-xs lg:text-sm px-1 sm:px-2 lg:px-3"
          >
            <span className="truncate">Text to Video</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="i2v" className="mt-3 sm:mt-4">
          <Separator className="my-2 sm:my-3" />
          <h2 className="mb-3 sm:mb-4 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold">
            Tạo video
          </h2>
          <div className="grid w-full gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="grid w-full gap-2 sm:gap-3">
              <Label
                htmlFor="select-topic"
                className="text-[6px] xs:text-[10px] sm:text-xs lg:text-sm"
              >
                Chọn chủ đề đã có
              </Label>
              <SelectTopicSection />
            </div>
            <p className="text-center text-muted-foreground text-[6px] xs:text-[10px] sm:text-xs lg:text-sm px-2">
              Hoặc tạo mới chủ đề
            </p>
            <Button
              variant="secondary"
              className="w-full text-[6px] xs:text-[10px] sm:text-xs lg:text-sm"
              onClick={handleOpent}
            >
              Tạo chủ đề mới
            </Button>
          </div>
          <CreateVideoSection />
        </TabsContent>
        <TabsContent value="t2v" className="mt-3 sm:mt-4">
          <Separator className="my-2 sm:my-3" />
          <div className="text-xs sm:text-sm lg:text-base text-muted-foreground">
            Change your password here.
          </div>
        </TabsContent>
      </Tabs>
      <CreateTopicModal
        isOpen={open}
        onCancel={handleCancel}
        setOpen={setOpen}
      />
    </>
  );
};

export default HailouAi;
