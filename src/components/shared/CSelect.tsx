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
import { Check, ChevronsUpDown } from "lucide-react";
import React from "react";

interface ComboboxOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface FlexibleComboboxProps {
  // Required props
  options: ComboboxOption[];
  value?: string | number | null;
  onValueChange?: (value: string | number | null) => void;

  // Display props
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;

  // Styling props
  className?: string;
  buttonClassName?: string;
  popoverClassName?: string;

  // Behavior props
  disabled?: boolean;
  searchable?: boolean;
  clearable?: boolean;

  // Size variants
  size?: "sm" | "md" | "lg";

  // Custom render functions
  renderOption?: (option: ComboboxOption) => React.ReactNode;
  renderValue?: (option: ComboboxOption) => React.ReactNode;
}

const sizeClasses = {
  sm: {
    button: "h-7 text-[9px] sm:text-xs px-1 sm:px-2",
    icon: "h-3 w-3",
    content: "text-xs",
  },
  md: {
    button: "h-8 sm:h-9 text-xs sm:text-sm px-2 sm:px-3",
    icon: "h-3 w-3 sm:h-4 sm:w-4",
    content: "text-xs sm:text-sm",
  },
  lg: {
    button:
      "h-9 sm:h-10 lg:h-11 text-sm sm:text-base lg:text-lg px-3 sm:px-4 lg:px-5",
    icon: "h-4 w-4 sm:h-5 sm:w-5",
    content: "text-sm sm:text-base",
  },
};

const FlexibleCombobox: React.FC<FlexibleComboboxProps> = ({
  options = [],
  value,
  onValueChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyMessage = "No options found.",
  className = "",
  buttonClassName = "",
  popoverClassName = "",
  disabled = false,
  searchable = true,
  clearable = false,
  size = "md",
  renderOption,
  renderValue,
}) => {
  const [open, setOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState<
    string | number | null
  >(value ?? null);

  const currentValue = value !== undefined ? value : internalValue;
  const sizeStyles = sizeClasses[size];

  // Helper function to convert value to string for Command component
  const valueToString = (val: string | number | null): string => {
    if (val === null || val === undefined) return "";
    return String(val);
  };

  // Helper function to convert back to original type
  const convertValue = (stringValue: string): string | number | null => {
    if (stringValue === "") return null;

    // Try to find the original option to maintain the original type
    const originalOption = options.find(
      (option) => String(option.value) === stringValue
    );
    return originalOption ? originalOption.value : stringValue;
  };

  const handleValueChange = (stringValue: string) => {
    const newValue = convertValue(stringValue);
    const finalValue =
      newValue === currentValue ? (clearable ? null : newValue) : newValue;

    if (value === undefined) {
      setInternalValue(finalValue);
    }

    onValueChange?.(finalValue);
    setOpen(false);
  };

  const selectedOption = options.find(
    (option) => option.value === currentValue
  );

  const renderButtonContent = () => {
    if (selectedOption) {
      return renderValue ? renderValue(selectedOption) : selectedOption.label;
    }
    return placeholder;
  };

  const renderOptionContent = (option: ComboboxOption) => {
    if (renderOption) {
      return renderOption(option);
    }
    return option.label;
  };

  return (
    <div className={cn("w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between text-muted-foreground",
              sizeStyles.button,
              selectedOption && "text-foreground",
              buttonClassName
            )}
          >
            <span className="truncate text-left max-w-[calc(100%-2rem)]">
              {renderButtonContent()}
            </span>
            <ChevronsUpDown
              className={cn(
                "opacity-50 flex-shrink-0 ml-1 sm:ml-2",
                sizeStyles.icon
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={cn("p-0", popoverClassName)}>
          <Command>
            {searchable && (
              <CommandInput
                placeholder={searchPlaceholder}
                className={sizeStyles.content}
              />
            )}
            <CommandList>
              <CommandEmpty
                className={cn("text-center py-4", sizeStyles.content)}
              >
                {emptyMessage}
              </CommandEmpty>
              <CommandGroup>
                {clearable &&
                  currentValue !== null &&
                  currentValue !== undefined && (
                    <CommandItem
                      value=""
                      onSelect={() => handleValueChange("")}
                      className={cn(
                        "text-muted-foreground italic",
                        sizeStyles.content
                      )}
                    >
                      Clear selection
                      <Check
                        className={cn("ml-auto opacity-0", sizeStyles.icon)}
                      />
                    </CommandItem>
                  )}
                {options.map((option) => (
                  <CommandItem
                    key={String(option.value)}
                    value={valueToString(option.value)}
                    disabled={option.disabled}
                    onSelect={() =>
                      handleValueChange(valueToString(option.value))
                    }
                    className={cn(
                      sizeStyles.content,
                      option.disabled && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {renderOptionContent(option)}
                    <Check
                      className={cn(
                        "ml-auto",
                        sizeStyles.icon,
                        currentValue === option.value
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
  );
};

export default FlexibleCombobox;
