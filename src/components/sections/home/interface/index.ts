import { IUser } from "@/types/user";
import { ReactElement } from "react";

// Types
export interface AIPlatform {
  key: string;
  name: string;
  icon: ReactElement;
  description: string;
  features: string[];
  gradient: string;
}

export interface UseAIPlatformsReturn {
  aiPlatforms: AIPlatform[];
}

export interface NavigationProps {
  user: IUser | null;
}

export interface PlatformCardProps {
  handleClick: () => void;
  platform: AIPlatform;
  index: number;
}
