import { AIPlatform, UseAIPlatformsReturn } from "@/components/sections/home/interface";
import { Sparkles, Video, Zap } from 'lucide-react';


export const useAIPlatforms = (): UseAIPlatformsReturn => {
  const aiPlatforms: AIPlatform[] = [
    {
      name: "Hailuo AI",
      icon: <Sparkles className="w-8 h-8" />,
      description:
        "Tạo video AI chất lượng cao với khả năng hiểu ngữ cảnh sâu sắc và render nhanh chóng",
      features: ["Text-to-Video", "High Quality", "Fast Processing"],
      gradient: "from-purple-500 to-pink-500",
    },
    {
      name: "Runway ML",
      icon: <Video className="w-8 h-8" />,
      description:
        "Công cụ AI tiên tiến cho việc chỉnh sửa và tạo video với nhiều tính năng sáng tạo",
      features: ["Video Editing", "Motion Graphics", "AI Effects"],
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      name: "MyDijone",
      icon: <Zap className="w-8 h-8" />,
      description:
        "Platform AI tạo video thông minh với giao diện thân thiện và kết quả ấn tượng",
      features: ["User Friendly", "Smart Templates", "Quick Export"],
      gradient: "from-orange-500 to-red-500",
    },
  ];

  return { aiPlatforms };
};
