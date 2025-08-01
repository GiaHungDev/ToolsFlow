import HailouAI from "@/components/sections/HailouAI";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DashboardPage = () => {
  return (
    <div className="flex h-[calc(100vh-81px)] overflow-hidden">
      {/* Left Sidebar - 25% */}
      <div className="w-1/4 bg-white border-r border-gray-200">
        <div className="p-4 h-full">
          <h4>Loại AI</h4>
          <Tabs defaultValue="hailou">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="hailou" className="w-full">
                Hailou AI
              </TabsTrigger>
              <TabsTrigger value="runway" className="w-full" disabled>
                Runway AI (tạm tắt)
              </TabsTrigger>
            </TabsList>
            <TabsContent value="hailou">
              <HailouAI />
            </TabsContent>
            <TabsContent value="runway">Change your password here.</TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Main Content - 75% */}
      <div className="flex-1 bg-white">
        <div className="p-4 h-full">
          {/* Nội dung chính sẽ được thêm vào đây */}
          <div className="h-full bg-gray-50 rounded-lg flex items-center justify-center">
            <span className="text-gray-400">Main Content</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
