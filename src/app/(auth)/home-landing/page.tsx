"use client";

import LoadingWrapper from "@/components/layout/LoadingWrapper";
import NavigationLanding from "@/components/sections/home-landing/NavigationLanding";
import AIPlatformsSection from "@/components/sections/home-landing/AIPlatformsLandingSection";
import CTASection from "@/components/sections/home-landing/CTALandingSection";
import HeroSection from "@/components/sections/home-landing/HeroLandingSection";
import { UseAIPlatformsReturn } from "@/components/sections/home/interface";
import { useAIPlatforms } from "@/hooks/home/useAIPlatforms";
import { useLogin } from "@/hooks/home-landing/useLogin";

const HomeLanding: React.FC = () => {
  const { aiPlatforms }: UseAIPlatformsReturn = useAIPlatforms();
  const { handleLogin, loading } = useLogin();

  return (
    <LoadingWrapper loading={loading}>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        {/* Navigation */}
        <NavigationLanding onLoginClick={handleLogin} />

        {/* Hero Section */}
        <HeroSection onGetStarted={handleLogin} />

        {/* AI Platforms Section */}
        <AIPlatformsSection platforms={aiPlatforms} />

        {/* CTA Section */}
        <CTASection onGetStarted={handleLogin} />
      </div>
    </LoadingWrapper>
  );
};

export default HomeLanding;
