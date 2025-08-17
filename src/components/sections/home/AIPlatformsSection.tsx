import { AIPlatform, AIPlatformsSectionProps } from "./interface";
import PlatformCard from "./PlatformCard";

const AIPlatformsSection: React.FC<AIPlatformsSectionProps> = ({
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

      <div className="grid md:grid-cols-3 gap-8">
        {platforms.map((platform: AIPlatform, index: number) => (
          <PlatformCard
            key={`${platform.name}-${index}`}
            platform={platform}
            index={index}
          />
        ))}
      </div>
    </div>
  </section>
);

export default AIPlatformsSection;
