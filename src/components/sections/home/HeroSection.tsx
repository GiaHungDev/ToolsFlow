import { ArrowRight, Sparkles } from "lucide-react";
import { HeroSectionProps } from "./interface";

// Hero Section Component
const HeroSection: React.FC<HeroSectionProps> = ({ onGetStarted }) => (
  <section className="pt-32 pb-20 px-6">
    <div className="max-w-6xl mx-auto text-center">
      <div className="inline-flex items-center space-x-2 bg-slate-800/50 px-4 py-2 rounded-full border border-slate-700 mb-8">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-sm text-slate-300">
          Powered by Advanced AI Technology
        </span>
      </div>

      <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent leading-tight">
        Tạo Video AI
        <br />
        <span className="text-4xl md:text-6xl">Chuyên Nghiệp</span>
      </h1>

      <p className="text-xl text-slate-300 mb-12 max-w-3xl mx-auto leading-relaxed">
        Khám phá sức mạnh của 3 nền tảng AI hàng đầu thế giới. Tạo video chất
        lượng cao, chỉnh sửa chuyên nghiệp và thỏa sức sáng tạo trong một ứng
        dụng duy nhất.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
        <button
          onClick={onGetStarted}
          type="button"
          className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-300 shadow-2xl hover:shadow-purple-500/30 transform hover:scale-105 flex items-center space-x-2"
        >
          <span>Bắt đầu ngay</span>
          <ArrowRight className="w-5 h-5" />
        </button>
        <button
          type="button"
          className="px-8 py-4 rounded-xl border border-slate-600 hover:border-slate-500 hover:bg-slate-800/50 transition-all duration-200 font-semibold text-lg"
        >
          Xem demo
        </button>
      </div>
    </div>
  </section>
);

export default HeroSection;
