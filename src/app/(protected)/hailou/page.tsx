import DataTableDemo from "@/components/customized/table/table-09";
import HailouAI from "@/components/sections/HailouAI";

const HailouPage = () => {
  return (
    <div className="flex">
      {/* Left Sidebar - 30% */}
      <div className="w-[30%] bg-white border-r border-gray-200">
        <div className="p-4 h-full">
          <HailouAI />
        </div>
      </div>

      {/* Main Content - 70% */}
      <div className="flex-1 bg-white">
        <div className="p-4 h-full">
          {/* Nội dung chính sẽ được thêm vào đây */}
          <DataTableDemo />
        </div>
      </div>
    </div>
  );
};

export default HailouPage;
