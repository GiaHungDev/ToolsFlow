"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ITopic } from "@/types/hailuo";
import { Check, ChevronsUpDown } from "lucide-react";
import React from "react";

interface SelectTopicSectionProps {
  listTopic: ITopic[];
  setOpen: (open: boolean) => void;
  open: boolean;
  handleSetTopic: (topic: ITopic | null) => void;
  selected: ITopic | null;
  topic: ITopic | null;
  handleSelect: (topic: ITopic) => void;
}

const SelectTopicSection: React.FC<SelectTopicSectionProps> = ({
  listTopic,
  setOpen,
  open,
  handleSetTopic,
  selected,
  topic,
  handleSelect,
}) => {
  return (
    <>
      <div className={cn("w-full")}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
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
                <CommandEmpty>Không tìm thấy kết quả.</CommandEmpty>
                <CommandGroup>
                  {selected && selected !== null && selected !== undefined && (
                    <CommandItem
                      value=""
                      onSelect={() => handleSetTopic(null)}
                      className={cn("text-muted-foreground italic")}
                    >
                      Clear selection
                      <Check className={cn("ml-auto opacity-0")} />
                    </CommandItem>
                  )}
                  {listTopic.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.title}-${item.id}`}
                      onSelect={() => {
                        handleSetTopic(item);
                        handleSelect(item);
                        setOpen(false);
                      }}
                    >
                      {item.title}
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          selected?.id === item.id ? "opacity-100" : "opacity-0"
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
    </>
  );
};

export default SelectTopicSection;
