"use client";

import FlowAI from "@/components/sections/flow-ai";
import TableSection from "@/components/sections/flow-ai/TableSection";
import { useFormFilter } from "@/hooks/flow-ai/useFormFilter";
import { useFormVideo } from "@/hooks/flow-ai/useFormVideo";

const HailouPage = () => {
  const formVideo = useFormVideo();
  const formFilter = useFormFilter();

  return (
    <div className="flex">
      {/* Left Sidebar - 30% */}
      <div className="w-[30%] min-h-[800px] bg-white border-r border-gray-200 flex-shrink-0">
        <div className="p-4 h-full overflow-auto">
          <FlowAI formVideo={formVideo} />
        </div>
      </div>

      {/* Main Content - 70% */}
      <div className="w-[70%] bg-white flex-shrink-0">
        <div className="p-4 h-full overflow-auto">
          <div className="w-full max-w-none">
            <TableSection formVideo={formVideo} formFilter={formFilter} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default HailouPage;
