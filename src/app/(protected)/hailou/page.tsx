import HailouAI from "@/components/sections/hailou-ai";
import AppTable from "@/components/sections/hailou-ai/TableSection";

const HailouPage = () => {
  return (
    <div className="flex">
      {/* Left Sidebar - 30% */}
      <div className="w-[30%] bg-white border-r border-gray-200 flex-shrink-0">
        <div className="p-4 h-full overflow-auto">
          <HailouAI />
        </div>
      </div>

      {/* Main Content - 70% */}
      <div className="w-[70%] bg-white flex-shrink-0">
        <div className="p-4 h-full overflow-auto">
          <div className="w-full max-w-none">
            <AppTable />
          </div>
        </div>
      </div>
    </div>
  );
};

export default HailouPage;
