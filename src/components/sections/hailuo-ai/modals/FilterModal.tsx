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
import { useFormFilter } from "@/hooks/hailou-ai/useFormFilter";
import { cn } from "@/lib/utils";
import { ITopic } from "@/types/hailuo";
import { videoStatus } from "@/types/listConstant";
import dayjs from "dayjs";
import { CalendarIcon, Check, ChevronsUpDown } from "lucide-react";

interface FilterModalProp {
  isOpenModal: boolean;
  onCancelModal: () => void;
  setOpenModal: (state: boolean) => void;
  formFilter: ReturnType<typeof useFormFilter>;
  isOpenSelectTopic: boolean;
  setIsOpenSelectTopic: (state: boolean) => void;
  listTopic: ITopic[];
  selected: ITopic | null;
  setTopic: (topic: ITopic | null) => void;
  topic: ITopic | null;
  loading: boolean;
  handleSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
}

const FilterModal: React.FC<FilterModalProp> = ({
  isOpenModal,
  onCancelModal,
  setOpenModal,
  formFilter,
  isOpenSelectTopic,
  setIsOpenSelectTopic,
  listTopic,
  selected,
  setTopic,
  topic,
  loading,
  handleSubmit,
}) => {
  return (
    <>
      <CDialog
        open={isOpenModal}
        onOpenChange={setOpenModal}
        title="Tìm kiếm"
        footer={
          <>
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
        className="max-w-[700px]"
        onlyCloseByButton
      >
        <Form {...formFilter}>
          <div className="space-y-4">
            <FormField
              control={formFilter.control}
              name="description"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Tìm theo mô tả</FormLabel>
                  <FormControl>
                    <Input placeholder="Nhập vào mô tả" {...field} />
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
              name="topic"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Tìm theo chủ đề</FormLabel>
                  <FormControl>
                    <div className={cn("w-full")}>
                      <Popover
                        open={isOpenSelectTopic}
                        onOpenChange={setIsOpenSelectTopic}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={isOpenSelectTopic}
                            className="w-full justify-between"
                          >
                            <span className="truncate">
                              {topic ? topic.title : "Chọn chủ đề"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0">
                          <Command>
                            <CommandInput placeholder="Tìm kiếm..." />
                            <CommandList>
                              <CommandEmpty>
                                Không tìm thấy kết quả.
                              </CommandEmpty>
                              <CommandGroup>
                                {selected &&
                                  selected !== null &&
                                  selected !== undefined && (
                                    <CommandItem
                                      value=""
                                      onSelect={() => setTopic(null)}
                                      className={cn(
                                        "text-muted-foreground italic"
                                      )}
                                    >
                                      Clear selection
                                      <Check
                                        className={cn("ml-auto opacity-0")}
                                      />
                                    </CommandItem>
                                  )}
                                {listTopic.map((item) => (
                                  <CommandItem
                                    key={item.id}
                                    value={`${item.title}-${item.id}`}
                                    onSelect={() => {
                                      setTopic(item);
                                      field.onChange(String(item.id));
                                      setIsOpenSelectTopic(false);
                                    }}
                                  >
                                    {item.title}
                                    <Check
                                      className={cn(
                                        "ml-auto h-4 w-4",
                                        selected?.id === item.id
                                          ? "opacity-100"
                                          : "opacity-0"
                                      )}
                                    />
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Chọn trạng thái" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
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
                <FormItem className="flex flex-col">
                  <FormLabel>Khoảng thời gian</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {field.value?.from ? (
                          field.value.to ? (
                            <>
                              {dayjs(field.value.from).format("DD/MM/YYYY")} -{" "}
                              {dayjs(field.value.to).format("DD/MM/YYYY")}
                            </>
                          ) : (
                            dayjs(field.value.from).format("DD/MM/YYYY")
                          )
                        ) : (
                          <span>Chọn khoảng ngày</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        initialFocus
                        mode="range"
                        selected={field.value}
                        onSelect={field.onChange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                  {fieldState.error && (
                    <p className="text-sm text-red-500 mt-1">
                      {fieldState.error.message}
                    </p>
                  )}
                </FormItem>
              )}
            />
          </div>
        </Form>
      </CDialog>
    </>
  );
};

export default FilterModal;
