"use client";

import { useState } from "react";
import LoadingWrapper from "@/components/layout/LoadingWrapper";
import AIPlatformsSection from "@/components/sections/home-landing/AIPlatformsLandingSection";
import CTASection from "@/components/sections/home-landing/CTALandingSection";
import HeroSection from "@/components/sections/home-landing/HeroLandingSection";
import NavigationLanding from "@/components/sections/home-landing/NavigationLanding";
import { UseAIPlatformsReturn } from "@/components/sections/home/interface";
import { useFlowPlatform } from "@/hooks/home/useAIPlatforms";
import LoginModal from "@/components/sections/auth/LoginModal";

const HomeLanding: React.FC = () => {
  const { aiPlatforms }: UseAIPlatformsReturn = useFlowPlatform();
  const [showLoginModal, setShowLoginModal] = useState(false);

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        {/* Navigation */}
        <NavigationLanding onLoginClick={() => setShowLoginModal(true)} />

        {/* Hero Section */}
        <HeroSection onGetStarted={() => setShowLoginModal(true)} />

        {/* AI Platforms Section */}
        <AIPlatformsSection platforms={aiPlatforms} />

        {/* CTA Section */}
        <CTASection onGetStarted={() => setShowLoginModal(true)} />
      </div>

      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} />
      )}
    </>
  );
};

export default HomeLanding;
