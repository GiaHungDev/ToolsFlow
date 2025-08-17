import { PlatformCardProps } from "./interface";

const PlatformCard: React.FC<PlatformCardProps> = ({ platform }) => (
  <div className="group relative bg-slate-800/40 backdrop-blur-sm rounded-2xl p-8 border border-slate-700 hover:border-slate-600 transition-all duration-500 hover:transform hover:scale-105 hover:shadow-2xl">
    <div className="absolute inset-0 bg-gradient-to-r opacity-0 group-hover:opacity-10 transition-opacity duration-500 rounded-2xl from-purple-500 to-pink-500"></div>

    <div
      className={`w-16 h-16 rounded-xl bg-gradient-to-r ${platform.gradient} flex items-center justify-center mb-6 group-hover:shadow-lg transition-all duration-300`}
    >
      {platform.icon}
    </div>

    <h3 className="text-2xl font-bold mb-4 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-purple-400 group-hover:to-pink-400 group-hover:bg-clip-text transition-all duration-300">
      {platform.name}
    </h3>

    <p className="text-slate-300 mb-6 leading-relaxed">
      {platform.description}
    </p>

    <div className="space-y-2">
      {platform.features.map((feature: string, idx: number) => (
        <div key={idx} className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full bg-gradient-to-r ${platform.gradient}`}
          ></div>
          <span className="text-sm text-slate-400">{feature}</span>
        </div>
      ))}
    </div>
  </div>
);

export default PlatformCard;
