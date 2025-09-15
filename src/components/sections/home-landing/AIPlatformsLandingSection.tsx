import { AIPlatformLanding, AIPlatformsLDSectionProps } from "./interface";
import PlatformCardLanding from "./PlatformCardLanding";

const AIPlatformsLandingSection: React.FC<AIPlatformsLDSectionProps> = ({
  platforms,
}) => (
  <section className="py-20 px-6">
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold mb-4">3 Nền Tảng AI Hàng Đầu</h2>
        <p className="text-xl text-slate-400">
          Tích hợp hoàn hảo trong một giao diện duy nhất
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {platforms.map((platform: AIPlatformLanding, index: number) => (
          <PlatformCardLanding
            key={platform.key}
            platform={platform}
            index={index}
          />
        ))}
      </div>
    </div>
  </section>
);

export default AIPlatformsLandingSection;
