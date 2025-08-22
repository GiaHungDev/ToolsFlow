import { ReactElement } from "react";

// Types
export interface AIPlatformLanding {
  key: string;
  name: string;
  icon: ReactElement;
  description: string;
  features: string[];
  gradient: string;
}

export interface UseAIPlatformsReturn {
  aiPlatforms: AIPlatformLanding[];
}

export interface NavigationLandingProps {
  onLoginClick: () => void;
}

export interface HeroSectionProps {
  onGetStarted: () => void;
}

export interface PlatformCardLandingProps {
  platform: AIPlatformLanding;
  index: number;
}

export interface AIPlatformsLDSectionProps {
  platforms: AIPlatformLanding[];
}

export interface CTASectionLandingProps {
  onGetStarted: () => void;
}
