import { ReactElement } from "react";

// Types
export interface AIPlatform {
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
  onLoginClick: () => void;
}

export interface HeroSectionProps {
  onGetStarted: () => void;
}

export interface PlatformCardProps {
  platform: AIPlatform;
  index: number;
}

export interface AIPlatformsSectionProps {
  platforms: AIPlatform[];
}

export interface CTASectionProps {
  onGetStarted: () => void;
}
