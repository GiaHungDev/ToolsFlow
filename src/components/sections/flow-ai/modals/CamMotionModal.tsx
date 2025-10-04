import { CDialog } from "@/components/shared/CDialog";
import { Button } from "@/components/ui/button";
import { CinematicPreset, cinematicPresets } from "@/types/cinematicPresets";

interface CamMotionProp {
  selectedPreset: CinematicPreset | null;
  setHoveredPreset: (value: number | null) => void;
  hoveredPreset: number | null;
  setOpenCamMotion: (open: boolean) => void;
  openCamMotion: boolean;
  handleCancelCamMotion: () => void;
  handlePresetSelect: (preset: CinematicPreset) => void;
  handleSubmit: () => void;
  videoRefs: React.MutableRefObject<Record<number, HTMLVideoElement | null>>;
  handleMouseEnter: (presetId: number) => void;
  handleMouseLeave: () => void;
}

const CamMotionModal: React.FC<CamMotionProp> = ({
  selectedPreset,
  hoveredPreset,
  setOpenCamMotion,
  openCamMotion,
  handleCancelCamMotion,
  handlePresetSelect,
  handleSubmit,
  videoRefs,
  handleMouseEnter,
  handleMouseLeave,
}) => {
  return (
    <>
      <CDialog
        open={openCamMotion}
        onOpenChange={setOpenCamMotion}
        title="Chọn góc quay camera"
        description="Chọn một trong những preset góc quay camera để tạo video cinematic"
        footer={
          <>
            <Button variant="secondary" onClick={handleCancelCamMotion}>
              Hủy chọn
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedPreset}
              className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Chọn góc quay
            </Button>
          </>
        }
        className="max-w-[900px]"
        onlyCloseByButton
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 max-h-[60vh] overflow-y-auto">
          {cinematicPresets.map((preset) => (
            <div
              key={preset.id}
              className={`
                relative cursor-pointer rounded-lg border-2 transition-all duration-200 overflow-hidden
                ${
                  selectedPreset?.id === preset.id
                    ? "border-blue-500 ring-2 ring-blue-200 shadow-lg"
                    : "border-gray-200 hover:border-gray-300"
                }
              `}
              onClick={() => handlePresetSelect(preset)}
              onMouseEnter={() => handleMouseEnter(preset.id)}
              onMouseLeave={handleMouseLeave}
            >
              {/* Video Preview */}
              <div className="aspect-video bg-gray-100 relative">
                <video
                  ref={(el) => {
                    videoRefs.current[preset.id] = el;
                  }}
                  src={preset.video}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  preload="auto" // Thay đổi từ metadata thành auto
                  playsInline // Thêm để tránh fullscreen trên mobile
                />

                {/* Selected Indicator */}
                {selectedPreset?.id === preset.id && (
                  <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center">
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}

                {/* Play Icon Overlay - hiện khi không hover */}
                {hoveredPreset !== preset.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20">
                    <div className="bg-white bg-opacity-90 rounded-full p-3 shadow-lg">
                      <svg
                        className="w-8 h-8 text-gray-700"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                )}

                {/* Playing Indicator - hiện khi hover */}
                {hoveredPreset === preset.id && (
                  <div className="absolute top-2 left-2 bg-green-500 text-white rounded-full px-2 py-1 text-xs font-medium">
                    Playing
                  </div>
                )}
              </div>

              {/* Preset Info */}
              <div className="p-3">
                <h3 className="font-semibold text-sm text-gray-900 mb-1">
                  {preset.label}
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {preset.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Selected Preset Info */}
        {selectedPreset && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-medium text-blue-900 mb-1">
              Góc quay đã chọn: {selectedPreset.label}
            </h4>
            <p className="text-sm text-blue-700">
              Camera movements: {selectedPreset.value}
            </p>
          </div>
        )}
      </CDialog>
    </>
  );
};

export default CamMotionModal;
