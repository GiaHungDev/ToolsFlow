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
import { useAppSelector, useAppDispatch } from "@/lib/redux/store";
import { deleteFlowVideo } from "@/lib/redux/slices/flowSlice";
import { getFlowVideoService } from "@/service/api/flowService";
import { Checkbox } from "@/components/ui/checkbox";
import { Notify } from "@/lib/Notify";
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
  const dispatch = useAppDispatch();
  const { listFlowVideo, loadFlow, paginationFlow } = useAppSelector(
    (state) => state.flow,
  );
  const [appliedFilters, setAppliedFilters] = useState<any>({});
  
  const { handlePaginationChange, pagination, setReload } = useTableData(appliedFilters);
  const {
    handleSelectionChange,
    selectedCount,
    handleRecreate,
    handleDelete,
    handleDeleteVideos,
    handleRecreateVideos,
  } = useTableActions({ formVideo, appliedFilters, setReload });

  const paginationInfo = {
    page: pagination.page,
    limit: pagination.limit,
    total: paginationFlow.total,
    totalPages: paginationFlow.totalPages,
  };

  const { setIsOpenVideoModal, isOpenVideoModal, handleShowVideo, videoUrl } =
    usePlayVideo();

  const handleApplyFilter = (filters: any) => {
    setAppliedFilters(filters);
    handlePaginationChange(1, pagination.limit);
  };

  const {
    handleOpenFilterModal,
    handleCloseFilterModal,
    isOpenFilterModal,
    setIsOpenFilterModal,
    handleSubmit,
  } = useFilter({ formFilter, onApplyFilter: handleApplyFilter });

  const currentProjectName = formFilter.watch("projectName");
  const [isOpenDeleteProjectModal, setIsOpenDeleteProjectModal] = useState(false);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [projectStats, setProjectStats] = useState<{
    success: IFlowVideo[];
    failed: IFlowVideo[];
    processing: IFlowVideo[];
    other: IFlowVideo[];
  }>({
    success: [],
    failed: [],
    processing: [],
    other: [],
  });
  const [selectedDeleteStatuses, setSelectedDeleteStatuses] = useState({
    success: false,
    failed: true,
    processing: false,
    other: false,
  });

  const fetchProjectStats = async () => {
    if (!currentProjectName) return;
    setIsFetchingStats(true);
    try {
      const res = await getFlowVideoService({ projectName: currentProjectName, limit: 1000, page: 1 });
      const allVideos = res.data || [];
      const stats = {
        success: [] as IFlowVideo[],
        failed: [] as IFlowVideo[],
        processing: [] as IFlowVideo[],
        other: [] as IFlowVideo[],
      };

      allVideos.forEach((v) => {
        const s = String(v.status || "").toLowerCase();
        if (s === "completed") stats.success.push(v);
        else if (s === "failed" || s === "error") stats.failed.push(v);
        else if (s === "pending" || s === "processing" || s === "generating") stats.processing.push(v);
        else stats.other.push(v);
      });

      setProjectStats(stats);
      setIsOpenDeleteProjectModal(true);
    } catch (error) {
      Notify({ title: "Lỗi", description: "Không thể lấy thông tin dự án", status: "error" });
    } finally {
      setIsFetchingStats(false);
    }
  };

  const handleConfirmDeleteProject = async () => {
    const toDelete: IFlowVideo[] = [];
    if (selectedDeleteStatuses.success) toDelete.push(...projectStats.success);
    if (selectedDeleteStatuses.failed) toDelete.push(...projectStats.failed);
    if (selectedDeleteStatuses.processing) toDelete.push(...projectStats.processing);
    if (selectedDeleteStatuses.other) toDelete.push(...projectStats.other);

    if (toDelete.length === 0) {
      Notify({ title: "Chưa chọn", description: "Vui lòng chọn ít nhất một trạng thái để xóa", status: "warning" });
      return;
    }

    setIsDeletingProject(true);
    try {
      const promises = toDelete.map((v) => dispatch(deleteFlowVideo(Number(v.id))));
      await Promise.all(promises);
      Notify({ title: "Thành công", description: `Đã xóa ${toDelete.length} video.`, status: "success" });
      setIsOpenDeleteProjectModal(false);
      setReload(prev => !prev);
    } catch (error) {
      Notify({ title: "Lỗi", description: "Không thể xóa tất cả video đã chọn", status: "error" });
    } finally {
      setIsDeletingProject(false);
    }
  };

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
                  // Use local Next.js API route to read local files, since the remote backend cannot read from local machine
                  finalUrl = `/api/local-image?path=${encodeURIComponent(imageStr)}`;
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
      <Button variant="outline" onClick={() => setReload(p => !p)} className="shadow-sm border-stone-200">
        <RefreshCcw className="w-4 h-4 mr-2" />
        Tải lại
      </Button>

      {currentProjectName && (
        <Button 
          variant="destructive" 
          onClick={fetchProjectStats} 
          disabled={isFetchingStats}
          className="shadow-sm"
        >
          {isFetchingStats ? (
            <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4 mr-2" />
          )}
          Xóa toàn bộ dự án
        </Button>
      )}
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
        videoUrl={videoUrl}   
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

      <AlertDialog open={isOpenDeleteProjectModal} onOpenChange={setIsOpenDeleteProjectModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa toàn bộ dự án: <span className="text-emerald-600">{currentProjectName}</span></AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 mt-2">
                <p>Chọn các video bạn muốn xóa dựa theo trạng thái:</p>
                <div className="space-y-3 bg-stone-50 p-4 rounded-xl border border-stone-200">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox 
                      checked={selectedDeleteStatuses.success}
                      onCheckedChange={(c) => setSelectedDeleteStatuses(p => ({ ...p, success: !!c }))}
                    />
                    <span className="flex-1 text-sm font-medium">Thành công</span>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700">{projectStats.success.length}</Badge>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox 
                      checked={selectedDeleteStatuses.failed}
                      onCheckedChange={(c) => setSelectedDeleteStatuses(p => ({ ...p, failed: !!c }))}
                    />
                    <span className="flex-1 text-sm font-medium">Thất bại / Lỗi</span>
                    <Badge variant="outline" className="bg-red-50 text-red-700">{projectStats.failed.length}</Badge>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox 
                      checked={selectedDeleteStatuses.processing}
                      onCheckedChange={(c) => setSelectedDeleteStatuses(p => ({ ...p, processing: !!c }))}
                    />
                    <span className="flex-1 text-sm font-medium">Đang xử lý</span>
                    <Badge variant="outline" className="bg-orange-50 text-orange-700">{projectStats.processing.length}</Badge>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox 
                      checked={selectedDeleteStatuses.other}
                      onCheckedChange={(c) => setSelectedDeleteStatuses(p => ({ ...p, other: !!c }))}
                    />
                    <span className="flex-1 text-sm font-medium">Khác (Unknown)</span>
                    <Badge variant="outline" className="bg-stone-100 text-stone-700">{projectStats.other.length}</Badge>
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingProject}>Hủy</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDeleteProject();
              }}
              disabled={isDeletingProject || (projectStats.success.length === 0 && projectStats.failed.length === 0 && projectStats.processing.length === 0 && projectStats.other.length === 0)} 
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeletingProject ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Tiến hành Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TableSection;
