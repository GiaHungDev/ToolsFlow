"use client";

import FlowAI from "@/components/sections/flow-ai";
import { useFormFilter } from "@/hooks/flow-ai/useFormFilter";
import { useFormVideo } from "@/hooks/flow-ai/useFormVideo";

const HailouPage = () => {
  const formVideo = useFormVideo();
  const formFilter = useFormFilter();

  return (
    <div className="flex h-[calc(100vh-60px)] bg-stone-50 overflow-hidden">
      <div className="w-full h-full flex-1 overflow-auto">
        <div className="w-full h-full mx-auto">
          <FlowAI formVideo={formVideo} formFilter={formFilter} />
        </div>
      </div>
    </div>
  );
};

export default HailouPage;
