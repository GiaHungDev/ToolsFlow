"use client";

import DataTable from "@/components/shared/CTable/DataTable";
import { TableColumn } from "@/components/shared/CTable/interface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFilter } from "@/hooks/flow-ai/useFilter";
import { useFormFilter } from "@/hooks/flow-ai/useFormFilter";
import { useFormVideo } from "@/hooks/flow-ai/useFormVideo";
import { usePlayVideo } from "@/hooks/flow-ai/usePlayVideo";
import { useTableActions } from "@/hooks/flow-ai/useTableActions";
import { useTableData } from "@/hooks/flow-ai/useTableData";
import { useAppSelector } from "@/lib/redux/store";
import { IFlowVideo } from "@/types/flow";
import { videoStatusTable } from "@/types/listConstant";
import dayjs from "dayjs";
import {
  Copy,
  Download,
  Ellipsis,
  Play,
  RefreshCcw,
  Search,
  Trash2,
  FileText,
  Images,
  Clapperboard,
  HelpCircle,
} from "lucide-react";
import Image from "next/image";
import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import FilterModal from "./modals/FilterModal";
import ShowVideoModal from "./modals/ShowVideoModal";

interface TableSectionProp {
  formVideo: ReturnType<typeof useFormVideo>;
  formFilter: ReturnType<typeof useFormFilter>;
}

const TableSection: React.FC<TableSectionProp> = ({
  formVideo,
  formFilter,
}) => {
  const { listFlowVideo, loadFlow, paginationFlow } = useAppSelector(
    (state) => state.flow,
  );
  const { handlePaginationChange, pagination } = useTableData();
  const {
    handleSelectionChange,
    selectedCount,
    handleRecreate,
    handleDelete,
    handleDeleteVideos,
    handleRecreateVideos,
    handleReload,
  } = useTableActions({ formVideo });

  const paginationInfo = {
    page: pagination.page,
    limit: pagination.limit,
    total: paginationFlow.total,
    totalPages: paginationFlow.totalPages,
  };

  const { setIsOpenVideoModal, isOpenVideoModal, handleShowVideo, videoUrl } =
    usePlayVideo();

  const {
    handleOpenFilterModal,
    handleCloseFilterModal,
    isOpenFilterModal,
    setIsOpenFilterModal,
    handleSubmit,
  } = useFilter({ formFilter: formFilter, paginationInfo: paginationInfo });

  const columns = useMemo<TableColumn<IFlowVideo>[]>(
    () => [
      {
        key: "#",
        title: "#",
        width: 60,
        render: (_value, _record, index) => {
          return <div>{index++}</div>;
        },
      },
      {
        key: "createdAt",
        title: "Ngày tạo",
        width: 150,
        className: "font-medium text-left",
        render: (value) => {
          if (!value) return <span className="text-gray-400">—</span>;
          return dayjs(value as string).format("DD/MM/YYYY");
        },
      },
      {
        key: "typeI2V",
        title: "Thể loại",
        width: 200,
        render: (value) => {
          const type = value as string;

          const getTypeInfo = (type: string) => {
            switch (type) {
              case "Text to Video":
                return {
                  icon: <FileText size={18} />,
                  label: "Text to Video",
                  color: "text-blue-500",
                };
              case "Frames to Video":
                return {
                  icon: <Images size={18} />,
                  label: "Frames to Video",
                  color: "text-green-500",
                };
              case "Ingredients to Video":
                return {
                  icon: <Clapperboard size={18} />,
                  label: "Ingredients to Video",
                  color: "text-purple-500",
                };

              case "Image to Video":
                return {
                  icon: <Clapperboard size={18} />,
                  label: "Image to Video",
                  color: "text-purple-500",
                };
              default:
                return {
                  icon: <HelpCircle size={18} />,
                  label: "Không xác định",
                  color: "text-gray-400",
                };
            }
          };

          const info = getTypeInfo(type);

          return (
            <div className={`flex items-center gap-2 ${info.color}`}>
              {info.icon}
              <span>{info.label}</span>
            </div>
          );
        },
      },
      {
        key: "images", // Chú ý: Backend trả về key là 'images' (số nhiều) nhé
        title: "Ảnh",
        width: 120,
        className: "font-medium text-center",
        render: (value) => {
          const imageArray = value as any[];
          if (!imageArray || imageArray.length === 0) {
            return <div className="text-gray-400">No image</div>;
          }

          const imageStrs: string[] = [];

          // Trích xuất tất cả các đường dẫn ảnh từ array/object
          for (const item of imageArray) {
            if (typeof item === "object" && item !== null) {
              const vals = Object.values(item);
              for (const v of vals) {
                if (typeof v === "string" && v.trim() !== "") {
                  imageStrs.push(v);
                }
              }
            } else if (typeof item === "string" && item.trim() !== "") {
              imageStrs.push(item);
            }
          }

          if (imageStrs.length === 0) {
            return <div className="text-gray-400">No image</div>;
          }

          const baseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000").replace(/\/$/, "");

          return (
            <div className="flex items-center justify-center gap-1 flex-wrap max-w-[150px]">
              {imageStrs.map((imageStr, idx) => {
                let finalUrl = "";
                if (imageStr.includes(":\\") || imageStr.startsWith("file://")) {
                  finalUrl = `${baseUrl}/flow/veo3/local-image?path=${encodeURIComponent(imageStr)}`;
                } else if (imageStr.startsWith("http")) {
                  finalUrl = imageStr;
                } else if (imageStr.startsWith("uploads/")) {
                  finalUrl = `${baseUrl}/${imageStr}`;
                } else {
                  finalUrl = `${baseUrl}/uploads/${imageStr}`;
                }

                return (
                  <div key={idx} className="w-[50px] h-[35px] relative shrink-0" title={imageStr}>
                    <Image
                      src={finalUrl}
                      alt={`Scene Image ${idx}`}
                      fill
                      className="rounded object-cover"
                      unoptimized
                    />
                  </div>
                );
              })}
            </div>
          );
        },
      },
      {
        key: "status",
        title: "Trạng thái",
        width: 120,
        className: "font-medium text-center",
        render: (value) => {
          const statusValue = String(value || "").toLowerCase();
          const status = videoStatusTable.find((s) => s.status.toLowerCase() === statusValue);

          if (!status) {
            return (
              <Badge
                variant="secondary"
                className="px-2 py-1 rounded-full w-32 mx-auto flex justify-center items-center"
              >
                Unknown
              </Badge>
            );
          }

          // Map màu từ status.color sang class Tailwind
          const colorMap: Record<string, string> = {
            blue: "bg-blue-100 text-blue-700",
            cyan: "bg-cyan-100 text-cyan-700",
            green: "bg-green-100 text-green-700",
            red: "bg-red-100 text-red-700",
            purple: "bg-purple-100 text-purple-700",
            orange: "bg-orange-100 text-orange-700",
          };

          return (
            <Badge
              className={`${colorMap[status.color] || ""
                } px-2 py-1 rounded-full w-32 mx-auto flex justify-center items-center`}
              variant={"outline"}
            >
              {status.label}
            </Badge>
          );
        },
      },
      {
        key: "prompt",
        title: "Mô tả",
        width: 200,
        render: (value) => {
          const text = value as string;
          if (!text)
            return <span className="text-gray-400">No description</span>;

          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="line-clamp-2 text-ellipsis overflow-hidden break-words cursor-pointer max-w-[180px]">
                  {text}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs break-words">{text}</p>
              </TooltipContent>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  const fixedRightColumns = useMemo<TableColumn<IFlowVideo>[]>(
    () => [
      {
        key: "actions",
        title: "Actions",
        width: 120,
        className: "text-center",
        render: (_value, record) => {

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-8 w-8 p-0">
                  <Ellipsis className="h-4 w-6" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-[160px]">
                {record.archiveStatus === "Archived" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => handleShowVideo(record.id)}
                      className="cursor-pointer"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Xem video
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                  </>
                )}

                <DropdownMenuItem
                  onClick={() => handleRecreate(record.id)}
                  className="cursor-pointer"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Tạo lại
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => handleDelete(record.id)}
                  className="cursor-pointer text-red-600 focus:text-red-600"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [handleRecreate, handleDelete, handleShowVideo],
  );

  const [mounted, setMounted] = useState(false);  const actionButtons = (
    <>
      <Button
        className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
        onClick={handleOpenFilterModal}
      >
        <Search className="w-4 h-4 mr-2" />
        Tìm kiếm
      </Button>

      {selectedCount > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="shadow-sm">
              <Trash2 className="w-4 h-4 mr-2" />
              {`Xóa ${selectedCount} video`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Xác nhận xóa video</AlertDialogTitle>
              <AlertDialogDescription>
                Bạn có chắc chắn muốn xóa {selectedCount} video đã chọn không? Hành động này không thể hoàn tác.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteVideos} className="bg-red-600 hover:bg-red-700">
                Đồng ý
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {selectedCount > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm border border-emerald-600">
              <RefreshCcw className="w-4 h-4 mr-2 animate-spin-hover" />
              {`Tạo lại ${selectedCount} video`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Xác nhận tạo lại video</AlertDialogTitle>
              <AlertDialogDescription>
                Bạn có chắc chắn muốn đưa {selectedCount} video đã chọn về trạng thái chờ tạo lại không?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction onClick={handleRecreateVideos} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Đồng ý
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <Button variant="outline" onClick={() => handleReload(pagination.page, pagination.limit)} className="shadow-sm border-stone-200">
        <RefreshCcw className="w-4 h-4 mr-2" />
        Tải lại
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="w-full bg-white rounded-3xl p-6 shadow-sm border border-stone-100">
        <DataTable<IFlowVideo>
          data={listFlowVideo}
          columns={columns}
          fixedRightColumns={fixedRightColumns}
          maxHeight="max-h-[1500px]"
          enableSelection={true}
          enablePagination={true}
          pageSizeOptions={[10, 20, 30, 50]}
          onSelectionChange={handleSelectionChange}
          pagination={paginationInfo}
          loading={loadFlow.loadGetFlow}
          onPaginationChange={handlePaginationChange}
          zebra={true}
          headerActions={actionButtons}
        />
      </div>
      <ShowVideoModal
        openVideoModal={isOpenVideoModal}
        setOpenVideoModal={setIsOpenVideoModal}
        videoUrl={videoUrl}   // 👈 CHỈ TRUYỀN videoUrl THẬT
        title="Xem video"
        description="Video được tạo bởi Flow AI."
      />

      <FilterModal
        formFilter={formFilter}
        isOpenModal={isOpenFilterModal}
        setOpenModal={setIsOpenFilterModal}
        onCancelModal={handleCloseFilterModal}
        handleSubmit={handleSubmit}
        loading={loadFlow.loadGetFlow}
      />
    </div>
  );
};

export default TableSection;
