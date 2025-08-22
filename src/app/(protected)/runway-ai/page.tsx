
const RunwayPage = () => {
  return (
    <div className="flex">
      {/* Left Sidebar - 25% */}
      <div className="w-1/4 bg-white border-r border-gray-200">
        <div className="p-4 h-full">
        </div>
      </div>

      {/* Main Content - 75% */}
      <div className="flex-1 bg-white">
        <div className="p-4 h-full">
          {/* Nội dung chính sẽ được thêm vào đây */}
          <div className="h-full bg-gray-50 rounded-lg flex items-center justify-center">
            <span className="text-gray-400">Main Content</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunwayPage;
