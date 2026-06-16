import { CDialog } from "@/components/shared/CDialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormFilter } from "@/hooks/flow-ai/useFormFilter";
import { cn } from "@/lib/utils";
import { ITopic } from "@/types/flow";
import { videoStatus } from "@/types/listConstant";
import { getProjectNamesService } from "@/service/api/flowService";
import dayjs from "dayjs";
import { CalendarIcon, Check, ChevronsUpDown } from "lucide-react";
import React, { useEffect, useState } from "react";

interface FilterModalProp {
  isOpenModal: boolean;
  onCancelModal: () => void;
  setOpenModal: (state: boolean) => void;
  formFilter: ReturnType<typeof useFormFilter>;
  loading: boolean;
  handleSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
}

const FilterModal: React.FC<FilterModalProp> = ({
  isOpenModal,
  onCancelModal,
  setOpenModal,
  formFilter,
  loading,
  handleSubmit,
}) => {
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    if (isOpenModal) {
      setLoadingProjects(true);
      getProjectNamesService()
        .then((res) => {
          setProjectNames(res);
        })
        .catch((err) => console.error("Lỗi tải danh sách dự án:", err))
        .finally(() => setLoadingProjects(false));
    }
  }, [isOpenModal]);

  return (
    <>
      <CDialog
        open={isOpenModal}
        onOpenChange={setOpenModal}
        title="Tìm kiếm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                formFilter.setValue("projectName", "");
                formFilter.setValue("status", "");
                formFilter.setValue("dateRange", undefined);
              }}
              disabled={loading}
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
            >
              Xóa tất cả lựa chọn
            </Button>
            <Button
              variant="secondary"
              onClick={onCancelModal}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={loading}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Tìm kiếm
            </Button>
          </>
        }
        className="max-w-[850px]"
        onlyCloseByButton
      >
        <Form {...formFilter}>
          <div className="space-y-6">
            {/* Hàng đầu tiên */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={formFilter.control}
                name="projectName"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Tìm theo tên dự án</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value || undefined}
                        onValueChange={(val) =>
                          field.onChange(val === "clear" ? "" : val)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Chọn tên dự án" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem
                              value="clear"
                              className="italic text-gray-500"
                            >
                              Bỏ chọn
                            </SelectItem>
                            {loadingProjects ? (
                              <SelectItem value="loading" disabled>
                                Đang tải...
                              </SelectItem>
                            ) : projectNames.length === 0 ? (
                              <SelectItem value="empty" disabled>
                                Không có dự án nào
                              </SelectItem>
                            ) : (
                              projectNames.map((name, idx) => (
                                <SelectItem key={idx} value={name}>
                                  {name}
                                </SelectItem>
                              ))
                            )}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    {fieldState.error && (
                      <p className="text-sm text-red-500 mt-1">
                        {fieldState.error.message}
                      </p>
                    )}
                  </FormItem>
                )}
              />
              <FormField
                control={formFilter.control}
                name="status"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Tìm theo trạng thái</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value || undefined}
                        onValueChange={(val) =>
                          field.onChange(val === "clear" ? "" : val)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Chọn trạng thái" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem
                              value="clear"
                              className="italic text-gray-500"
                            >
                              Bỏ chọn
                            </SelectItem>
                            {videoStatus.map((item) => (
                              <SelectItem key={item.id} value={item.status}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    {fieldState.error && (
                      <p className="text-sm text-red-500 mt-1">
                        {fieldState.error.message}
                      </p>
                    )}
                  </FormItem>
                )}
              />
              <FormField
                control={formFilter.control}
                name="dateRange"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Khoảng thời gian</FormLabel>
                    <FormControl>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                            {field.value?.from ? (
                              field.value.to ? (
                                <span>
                                  {dayjs(field.value.from).format("DD/MM/YYYY")}{" "}
                                  - {dayjs(field.value.to).format("DD/MM/YYYY")}
                                </span>
                              ) : (
                                <span>
                                  {dayjs(field.value.from).format("DD/MM/YYYY")}
                                </span>
                              )
                            ) : (
                              <span>Chọn khoảng ngày</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="center"
                          className="p-2 w-[580px]"
                        >
                          <div className="flex flex-col gap-2">
                            <Calendar
                              mode="range"
                              selected={field.value}
                              captionLayout="dropdown"
                              onSelect={field.onChange}
                              numberOfMonths={2}
                              className="mx-auto"
                            />
                            {field.value?.from && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="self-end text-red-500"
                                onClick={() => field.onChange(undefined)}
                              >
                                Bỏ chọn
                              </Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </FormControl>
                    {fieldState.error && (
                      <p className="text-sm text-red-500 mt-1">
                        {fieldState.error.message}
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </div>
          </div>
        </Form>
      </CDialog>
    </>
  );
};

export default FilterModal;
