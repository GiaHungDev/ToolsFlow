import { CDialog } from "@/components/shared/CDialog";
import ReactPlayer from "react-player";

interface VideoModalProp {
  setOpenVideoModal: (open: boolean) => void;
  openVideoModal: boolean;
  videoUrl?: string;
  title?: string;
  description?: string;
}
const ShowVideoModal: React.FC<VideoModalProp> = ({
  setOpenVideoModal,
  openVideoModal,
  videoUrl,
  title,
  description,
}) => {
  return (
    <CDialog
      open={openVideoModal}
      onOpenChange={setOpenVideoModal}
      title=""
      description=""
      className="max-w-4xl"
      onlyCloseByButton
    >
      <div className="space-y-4">
        {/* Header */}
        {(title || description) && (
          <div className="space-y-2">
            {title && (
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-gray-600 dark:text-gray-300">{description}</p>
            )}
          </div>
        )}

        {/* Video Player */}
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {videoUrl ? (
            <ReactPlayer src={videoUrl} controls width="100%" height="100%" />
          ) : (
            <div className="flex items-center justify-center h-64 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <p className="text-gray-500 dark:text-gray-400">
                No video URL provided
              </p>
            </div>
          )}
        </div>
      </div>
    </CDialog>
  );
};

export default ShowVideoModal;
