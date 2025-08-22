"use client";

import { CTASectionLandingProps } from "./interface";

const CTASection: React.FC<CTASectionLandingProps> = ({ onGetStarted }) => (
  <section className="py-20 px-6">
    <div className="max-w-4xl mx-auto text-center bg-gradient-to-r from-purple-900/20 to-pink-900/20 rounded-3xl p-12 border border-slate-700">
      <h2 className="text-4xl font-bold mb-6">Sẵn sàng tạo ra điều kỳ diệu?</h2>
      <p className="text-xl text-slate-300 mb-8">
        Tham gia cùng hàng nghìn người sáng tạo đang sử dụng Harumi AI
      </p>
      <button
        onClick={onGetStarted}
        type="button"
        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 px-10 py-4 rounded-xl font-semibold text-lg transition-all duration-300 shadow-2xl hover:shadow-purple-500/30 transform hover:scale-105"
      >
        Bắt đầu miễn phí
      </button>
    </div>
  </section>
);

export default CTASection;
