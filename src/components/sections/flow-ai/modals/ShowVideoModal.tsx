import { CDialog } from "@/components/shared/CDialog";


interface VideoModalProp {
  setOpenVideoModal: (open: boolean) => void;
  openVideoModal: boolean;
  videoUrl: string | null;
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
        {(title || description) && (
          <div className="space-y-2">
            {title && (
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-gray-600 dark:text-gray-300">
                {description}
              </p>
            )}
          </div>
        )}

        {/* Video Player */}
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {!videoUrl && (
            <div className="flex items-center justify-center h-64 bg-gray-100 dark:bg-gray-800">
              <p className="text-gray-500 dark:text-gray-400">
                Đang tải video...
              </p>
            </div>
          )}

          {videoUrl && (
            <video
              src={videoUrl}
              controls
              preload="metadata"
              className="w-full h-full"
            />
          )}
        </div>
      </div>
    </CDialog>
  );
};


export default ShowVideoModal;
