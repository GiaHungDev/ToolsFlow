"use client";

import AIPlatformsSection from "@/components/sections/home/AIPlatformsSection";
import CTASection from "@/components/sections/home/CTASection";
import HeroSection from "@/components/sections/home/HeroSection";
import { UseAIPlatformsReturn } from "@/components/sections/home/interface";
import Navigation from "@/components/sections/home/Navigation";
import { useAIPlatforms } from "@/hooks/home/useAIPlatforms";
import { useLogin } from "@/hooks/home/useLogin";

const Home: React.FC = () => {
  const { aiPlatforms }: UseAIPlatformsReturn = useAIPlatforms();
  const { handleLoginClick, handleGetStarted } = useLogin();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Navigation */}
      <Navigation onLoginClick={handleLoginClick} />

      {/* Hero Section */}
      <HeroSection onGetStarted={handleGetStarted} />

      {/* AI Platforms Section */}
      <AIPlatformsSection platforms={aiPlatforms} />

      {/* CTA Section */}
      <CTASection onGetStarted={handleGetStarted} />
    </div>
  );
};

export default Home;
