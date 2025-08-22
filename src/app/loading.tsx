import { Video } from "lucide-react";

const Loading = () => {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
      {/* Subtle animated particles */}
      <div className="absolute inset-0">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-0.5 bg-white rounded-full opacity-10 animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 4}s`,
              animationDuration: `${3 + Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      {/* Main loading spinner */}
      <div className="text-center z-10">
        <div className="relative">
          {/* Outer spinning ring */}
          <div className="animate-spin rounded-full h-16 w-16 border-2 border-gray-800 border-t-white mx-auto">
            {/* Inner icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Video className="w-7 h-7 text-gray-400 animate-pulse" />
            </div>
          </div>

          {/* Subtle pulse ring */}
          <div className="absolute inset-0 rounded-full border border-gray-600 opacity-20 animate-ping"></div>
        </div>
      </div>
    </div>
  );
};

export default Loading;
