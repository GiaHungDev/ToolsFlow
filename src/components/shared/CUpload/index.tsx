import { Input } from "@/components/ui/input";
import { Eye, Upload, X } from "lucide-react";
import React, { useRef, useState } from "react";

// Types
export interface FileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: string;
}

interface FileUploadProps {
  // Callback khi files thay đổi
  onFilesChange?: (files: FileItem[]) => void;
  // Callback khi file được thêm
  onFileAdd?: (files: FileItem[]) => void;
  // Callback khi file được xóa
  onFileRemove?: (fileId: string) => void;
  // Giới hạn số lượng file
  maxFiles?: number;
  // Giới hạn kích thước file (MB)
  maxFileSize?: number;
  // Loại file được chấp nhận
  acceptedTypes?: string[];
  // Text tùy chỉnh
  title?: string;
  subtitle?: string;
  supportText?: string;
  sizeText?: string;
  // Styling
  className?: string;
  // Disable component
  disabled?: boolean;
  // Show/hide preview
  showPreview?: boolean;
}

const FileUploadComponent: React.FC<FileUploadProps> = ({
  onFilesChange,
  onFileAdd,
  onFileRemove,
  maxFiles = 10,
  maxFileSize = 20,
  acceptedTypes = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".gif"],
  title = "Kéo thả file vào đây hoặc click để chọn file",
  subtitle = "",
  supportText = "Kích thước file tối đa 20MB mỗi file",
  sizeText = "Dung lượng",
  className = "",
  disabled = false,
  showPreview = true,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    // Kiểm tra kích thước
    if (file.size > maxFileSize * 1024 * 1024) {
      return `File "${file.name}" vượt quá ${maxFileSize}MB`;
    }

    // Kiểm tra loại file
    const fileExtension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!acceptedTypes.some((type) => type.toLowerCase() === fileExtension)) {
      return `File "${file.name}" không được hỗ trợ`;
    }

    return null;
  };

  const handleFileSelect = (files: FileList) => {
    if (disabled) return;

    setError("");
    const newFiles: FileItem[] = [];
    const errors: string[] = [];

    // Kiểm tra giới hạn số lượng file
    if (selectedFiles.length + files.length > maxFiles) {
      setError(`Chỉ được phép tải lên tối đa ${maxFiles} file`);
      return;
    }

    Array.from(files).forEach((file) => {
      const validationError = validateFile(file);
      if (validationError) {
        errors.push(validationError);
      } else {
        const fileItem: FileItem = {
          id: Math.random().toString(36).substr(2, 9),
          file: file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: "Hoàn thành",
        };
        newFiles.push(fileItem);
      }
    });

    if (errors.length > 0) {
      setError(errors.join(", "));
    }

    if (newFiles.length > 0) {
      const updatedFiles = [...selectedFiles, ...newFiles];
      setSelectedFiles(updatedFiles);

      // Callbacks
      onFileAdd?.(newFiles);
      onFilesChange?.(updatedFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      handleFileSelect(files);
    }
  };

  const removeFile = (fileId: string) => {
    if (disabled) return;

    const updatedFiles = selectedFiles.filter((file) => file.id !== fileId);
    setSelectedFiles(updatedFiles);

    // Callbacks
    onFileRemove?.(fileId);
    onFilesChange?.(updatedFiles);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = (fileType: string): string => {
    if (fileType.includes("pdf")) return "📄";
    if (fileType.includes("image")) return "🖼️";
    if (fileType.includes("word") || fileType.includes("document")) return "📝";
    return "📄";
  };

  const totalSize = selectedFiles.reduce(
    (sum, file) => sum + file.file.size,
    0
  );

  return (
    <div className={`w-full space-y-4 ${className}`}>
      {/* Upload Area - Responsive */}
      <div
        className={`border-2 border-dashed rounded-lg p-4 sm:p-6 text-center transition-all duration-200 ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${
          isDragOver && !disabled
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <div className="flex flex-col items-center space-y-2">
          <div
            className={`w-4 h-4 sm:w-6 sm:h-6 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center ${
              disabled ? "bg-gray-100" : "bg-blue-100"
            }`}
          >
            <Upload
              className={`w-2 h-2 sm:w-4 sm:h-4 lg:w-6 lg:h-6 ${
                disabled ? "text-gray-400" : "text-blue-500"
              }`}
            />
          </div>

          <div className="space-y-1">
            <h6
              className={`sm:text-xs lg:text-sm font-normal ${
                disabled ? "text-gray-400" : "text-gray-700"
              } px-2 sm:px-0`}
            >
              {title}
            </h6>
            {subtitle && (
              <p
                className={`text-sm ${
                  disabled ? "text-gray-400" : "text-gray-500"
                } px-2 sm:px-0`}
              >
                {subtitle}
              </p>
            )}
            <p
              className={`text-xs ${
                disabled ? "text-gray-300" : "text-gray-400"
              } px-2 sm:px-0`}
            >
              {supportText}
            </p>
          </div>
        </div>

        <Input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={acceptedTypes.join(",")}
          onChange={handleFileInputChange}
          disabled={disabled}
        />
      </div>

      {/* Error Message - Responsive */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600 break-words">{error}</p>
        </div>
      )}

      {/* File List - Responsive */}
      {showPreview && selectedFiles.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-gray-700">
            Danh sách file đã chọn ({selectedFiles.length} file)
          </h4>

          <div className="space-y-2">
            {selectedFiles.map((fileItem) => (
              <div
                key={fileItem.id}
                className="flex items-start sm:items-center justify-between p-3 bg-gray-50 rounded-lg border gap-3"
              >
                <div className="flex items-start sm:items-center space-x-3 flex-1 min-w-0">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 rounded-lg flex items-center justify-center text-sm sm:text-lg flex-shrink-0">
                    {getFileIcon(fileItem.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {fileItem.name}
                    </p>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 text-xs text-gray-500 space-y-1 sm:space-y-0 mt-1">
                      <span>{formatFileSize(fileItem.size)}</span>
                      <span className="hidden sm:inline">•</span>
                      <span className="capitalize">
                        {fileItem.file.type.split("/")[1] || "file"}
                      </span>
                      <span className="hidden sm:inline">•</span>
                      <span className="text-green-600 font-medium">
                        {fileItem.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center space-y-1 sm:space-y-0 sm:space-x-2 flex-shrink-0">
                  <button
                    className="p-1.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
                    title="Xem trước"
                    disabled={disabled}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeFile(fileItem.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title="Xóa file"
                    disabled={disabled}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Summary - Mobile Responsive */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center pt-2 border-t text-sm space-y-2 sm:space-y-0">
            <span className="text-blue-600 font-medium">
              Tổng cộng: {selectedFiles.length} file
            </span>
            <span className="text-gray-600">
              {sizeText}: {formatFileSize(totalSize)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// Export both components
export { FileUploadComponent };
