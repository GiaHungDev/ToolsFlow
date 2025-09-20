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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFilter } from "@/hooks/hailou-ai/useFilter";
import { useFormFilter } from "@/hooks/hailou-ai/useFormFilter";
import { useFormVideo } from "@/hooks/hailou-ai/useFormVideo";
import { usePlayVideo } from "@/hooks/hailou-ai/usePlayVideo";
import { useTableActions } from "@/hooks/hailou-ai/useTableActions";
import { useTableData } from "@/hooks/hailou-ai/useTableData";
import { useAppSelector } from "@/lib/redux/store";
import { IHailuoVideo } from "@/types/hailuo";
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
} from "lucide-react";
import Image from "next/image";
import React, { useMemo } from "react";
import FilterModal from "./modals/FilterModal";
import ShowVideoModal from "@/components/sections/hailuo-ai/modals/ShowVideoModal";

interface TableSectionProp {
  formVideo: ReturnType<typeof useFormVideo>;
  formFilter: ReturnType<typeof useFormFilter>;
}

const TableSection: React.FC<TableSectionProp> = ({
  formVideo,
  formFilter,
}) => {
  const { listHailuoVideo, loadHailuo, paginationHailuo } = useAppSelector(
    (state) => state.hailuo
  );
  const { handlePaginationChange, pagination } = useTableData();
  const {
    handleSelectionChange,
    selectedCount,
    handleDownloadVideo,
    handleDownloadVideos,
    handleRecreate,
    handleDelete,
    handleReload,
  } = useTableActions({ formVideo });

  const paginationInfo = {
    page: pagination.page,
    limit: pagination.limit,
    total: paginationHailuo.total,
    totalPages: paginationHailuo.totalPages,
  };

  const { setIsOpenVideoModal, isOpenVideoModal, handleShowVideo, videoUrl } =
    usePlayVideo();

  const {
    isOpenSelectTopic,
    setIsOpenSelectTopic,
    listTopic,
    selected,
    setTopic,
    topic,
    handleOpenFilterModal,
    handleCloseFilterModal,
    isOpenFilterModal,
    setIsOpenFilterModal,
    handleSubmit,
  } = useFilter({ formFilter: formFilter, paginationInfo: paginationInfo });

  const columns = useMemo<TableColumn<IHailuoVideo>[]>(
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
        key: "updatedAt",
        title: "Ngày cập nhật",
        width: 200,
        className: "font-medium text-left",
        render: (value) => {
          if (!value) return <span className="text-gray-400">—</span>;
          return dayjs(value as string).format("DD/MM/YYYY HH:mm");
        },
      },
      {
        key: "thumbnail",
        title: "Ảnh",
        width: 120,
        className: "font-medium text-center",
        render: (value) => {
          const thumbnailUrl = value as string;
          if (!thumbnailUrl)
            return <div className="text-gray-400">No image</div>;

          return (
            <div className="flex items-center justify-center">
              <div className="w-[60px] h-[40px] relative">
                <Image
                  src={thumbnailUrl}
                  alt="Thumbnail"
                  fill
                  className="rounded object-cover"
                  unoptimized
                />
              </div>
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
          const status = videoStatusTable.find((s) => s.status === value);

          if (!status) {
            return (
              <Badge
                variant="secondary"
                className="px-2 py-1 rounded-full w-32"
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
              className={`${
                colorMap[status.color] || ""
              } px-2 py-1 rounded-full w-32 flex justify-center`}
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
    []
  );

  const fixedRightColumns = useMemo<TableColumn<IHailuoVideo>[]>(
    () => [
      {
        key: "actions",
        title: "Actions",
        width: 120,
        className: "text-center",
        render: (_value, record) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-8 w-8 p-0">
                <Ellipsis className="h-4 w-6" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[160px]">
              {record.videoURL && (
                <>
                  <DropdownMenuItem
                    onClick={() => handleShowVideo(record.id)}
                    className="cursor-pointer"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Xem video
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleDownloadVideo(record.id)}
                    className="cursor-pointer"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Tải xuống
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
        ),
      },
    ],
    [handleDownloadVideo, handleRecreate, handleDelete, handleShowVideo]
  );

  return (
    <>
      <div className="flex justify-end space-x-2 rounded-lg p-2 bg-gray-50 mb-2">
        {selectedCount > 0 && (
          <Button variant="default" onClick={handleDownloadVideos}>
            <Download />
            {`Tải xuống ${selectedCount} video`}
          </Button>
        )}
        <Button
          className="bg-blue-500 hover:bg-blue-400"
          onClick={handleOpenFilterModal}
        >
          <Search />
          Tìm kiếm
        </Button>
        <Button variant="outline" onClick={handleReload}>
          <RefreshCcw />
          Tải lại dữ liệu
        </Button>
      </div>
      <div className="rounded-lg p-2 bg-gray-50">
        <DataTable<IHailuoVideo>
          data={listHailuoVideo}
          columns={columns}
          fixedRightColumns={fixedRightColumns}
          title="Danh sách video Hailou AI"
          maxHeight="max-h-[calc(100vh-250px)] sm:max-h-[calc(100vh-300px)] lg:max-h-[calc(100vh-350px)]"
          enableSelection={true}
          enablePagination={true}
          pageSizeOptions={[10, 20, 30, 50]}
          onSelectionChange={handleSelectionChange}
          pagination={paginationInfo}
          loading={loadHailuo.loadGetHailuo}
          onPaginationChange={handlePaginationChange}
          zebra={true}
        />
      </div>
      <ShowVideoModal
        openVideoModal={isOpenVideoModal}
        setOpenVideoModal={setIsOpenVideoModal}
        videoUrl={
          videoUrl ? videoUrl : "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        }
        title="Xem video"
        description="Video được tạo bởi Hailuo AI."
      />
      <FilterModal
        formFilter={formFilter}
        isOpenModal={isOpenFilterModal}
        setOpenModal={setIsOpenFilterModal}
        onCancelModal={handleCloseFilterModal}
        listTopic={listTopic}
        selected={selected}
        isOpenSelectTopic={isOpenSelectTopic}
        setIsOpenSelectTopic={setIsOpenSelectTopic}
        setTopic={setTopic}
        topic={topic}
        handleSubmit={handleSubmit}
        loading={loadHailuo.loadGetHailuo}
      />
    </>
  );
};

export default TableSection;
