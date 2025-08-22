import { NavigationLandingProps } from "./interface";

const NavigationLanding: React.FC<NavigationLandingProps> = ({
  onLoginClick,
}) => (
  <nav className="fixed w-full top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-700">
    <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
          H
        </div>
        <span className="text-xl font-bold">Harumi AI</span>
      </div>
      <button
        onClick={onLoginClick}
        type="button"
        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 px-6 py-2 rounded-lg font-medium transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
      >
        Đăng nhập
      </button>
    </div>
  </nav>
);

export default NavigationLanding;
