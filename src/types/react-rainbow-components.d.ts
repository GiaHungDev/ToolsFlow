import { ComponentType } from "react";

declare module "react-rainbow-components" {
  export interface DatePickerProps {
    value?: Date | string | null;
    onChange?: (date: Date | null) => void;
    className?: string;
    placeholder?: string;
    label?: React.ReactNode;
    formatStyle?: "small" | "medium" | "large";
    [key: string]: any;
  }

  export const DatePicker: ComponentType<DatePickerProps>;
}
