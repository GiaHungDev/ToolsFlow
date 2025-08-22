"use client";

import LoadingWrapper from "@/components/layout/LoadingWrapper";
import {
  AIPlatform,
  UseAIPlatformsReturn,
} from "@/components/sections/home/interface";
import Navigation from "@/components/sections/home/Navigation";
import PlatformCard from "@/components/sections/home/PlatformCard";
import { useAIPlatforms } from "@/hooks/home/useAIPlatforms";
import { useCheck } from "@/hooks/home/useCheck";

const Home: React.FC = () => {
  const { aiPlatforms }: UseAIPlatformsReturn = useAIPlatforms();

  const { user, loading, handleRedirectClick } = useCheck();

  return (
    <LoadingWrapper loading={loading}>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        {/* Navigation */}
        <Navigation user={user} />

        {/* AI Platforms Section */}
        <section className="flex items-center justify-center min-h-screen px-6">
          <div className="max-w-6xl mx-auto text-center">
            <div className="mb-16">
              <h2 className="text-4xl font-bold mb-4">Chọn nền tảng AI</h2>
              <p className="text-xl text-slate-400">
                Chọn nền tảng AI để thực hiện tạo video
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {aiPlatforms.map((platform: AIPlatform, index: number) => (
                <PlatformCard
                  key={platform.key}
                  platform={platform}
                  index={index}
                  handleClick={() => handleRedirectClick(platform)}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </LoadingWrapper>
  );
};

export default Home;
