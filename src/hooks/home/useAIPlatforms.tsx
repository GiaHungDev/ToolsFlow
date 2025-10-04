import {
  AIPlatform,
  UseAIPlatformsReturn,
} from "@/components/sections/home/interface";
import { Sparkles, Video, Zap } from "lucide-react";

export const useAIPlatforms = (): UseAIPlatformsReturn => {
  const aiPlatforms: AIPlatform[] = [
    {
      key: "hailuo",
      name: "Flow AI",
      icon: <Sparkles className="w-8 h-8" />,
      description:
        "Tạo video AI chất lượng cao với khả năng hiểu ngữ cảnh sâu sắc và render nhanh chóng",
      features: ["Text-to-Video", "High Quality", "Fast Processing"],
      gradient: "from-purple-500 to-pink-500",
    },
    {
      key: "runway",
      name: "Runway ML",
      icon: <Video className="w-8 h-8" />,
      description:
        "Công cụ AI tiên tiến cho việc chỉnh sửa và tạo video với nhiều tính năng sáng tạo",
      features: ["Video Editing", "Motion Graphics", "AI Effects"],
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      key: "myDijone",
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

export const useFlowPlatform = (): UseAIPlatformsReturn => {
  const aiPlatforms: AIPlatform[] = [
    {
      key: "flow",
      name: "Flow AI",
      icon: <Sparkles className="w-8 h-8" />,
      description:
        "Công cụ làm phim bằng AI mới của Google, cho phép bạn tạo các đoạn clip, cảnh quay và câu chuyện mang tính điện ảnh một cách liền mạch và nhất quán, sử dụng các mô hình AI tiên tiến nhất như Veo 3.",
      features: [
        "Tạo clip và cảnh quay điện ảnh",
        "Đảm bảo tính nhất quán giữa các cảnh",
        "Sử dụng mô hình AI tiên tiến Veo 3",
      ],
      gradient: "from-blue-500 to-indigo-500",
    },
  ];

  return { aiPlatforms };
};
