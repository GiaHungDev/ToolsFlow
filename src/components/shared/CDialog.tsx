"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import React from "react";

interface FlexibleDialogProps {
  // Trigger props
  trigger?: React.ReactNode;
  triggerAsChild?: boolean;

  // Dialog state
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  // Content props
  title?: string;
  description?: string;
  children?: React.ReactNode;

  // Footer props
  showFooter?: boolean;
  cancelText?: string;
  confirmText?: string;
  onCancel?: () => void;
  onConfirm?: () => void;

  // Form props
  isForm?: boolean;
  onSubmit?: (e: React.FormEvent) => void;

  // Styling props
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  footerClassName?: string;

  // Size variants
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "full";

  // Behavior props
  closeOnOverlayClick?: boolean;
  showCloseButton?: boolean;
  loading?: boolean;
  disabled?: boolean;

  // Custom components
  customHeader?: React.ReactNode;
  customFooter?: React.ReactNode;

  // Close mode
  closeMode?: "default" | "button-only";
}

const sizeClasses = {
  xs: "sm:max-w-xs",
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  full: "sm:max-w-[95vw] sm:max-h-[95vh]",
};

const FlexibleDialog: React.FC<FlexibleDialogProps> = ({
  trigger,
  triggerAsChild = true,
  open,
  onOpenChange,
  title,
  description,
  children,
  showFooter = true,
  cancelText = "Hủy",
  confirmText = "Xác nhận",
  onCancel,
  onConfirm,
  isForm = false,
  onSubmit,
  className = "",
  contentClassName = "",
  headerClassName = "",
  footerClassName = "",
  size = "md",
  closeOnOverlayClick = true,
  showCloseButton = true,
  loading = false,
  disabled = false,
  customHeader,
  customFooter,
  closeMode = "default",  
}) => {
  const [internalOpen, setInternalOpen] = React.useState(false);

  const isOpen = open !== undefined ? open : internalOpen;
  const handleOpenChange = (newOpen: boolean) => {
    if (open === undefined) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  const handleCancel = () => {
    onCancel?.();
    handleOpenChange(false);
  };

  const handleConfirm = (e?: React.FormEvent) => {
    if (isForm && e) {
      e.preventDefault();
      onSubmit?.(e);
    } else {
      onConfirm?.();
    }

    if (!loading) {
      handleOpenChange(false);
    }
  };

  const DialogContentWrapper = isForm ? "form" : "div";

  const renderTrigger = () => {
    if (!trigger) return null;

    if (triggerAsChild && React.isValidElement(trigger)) {
      return <DialogTrigger asChild>{trigger}</DialogTrigger>;
    }

    return <DialogTrigger>{trigger}</DialogTrigger>;
  };

  const renderHeader = () => {
    if (customHeader) return customHeader;

    if (!title && !description) return null;

    return (
      <DialogHeader className={cn(headerClassName)}>
        {title && (
          <DialogTitle className="text-sm sm:text-base lg:text-lg">
            {title}
          </DialogTitle>
        )}
        {description && (
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        )}
      </DialogHeader>
    );
  };

  const renderFooter = () => {
    if (customFooter) return customFooter;

    if (!showFooter) return null;

    return (
      <DialogFooter className={cn("gap-2 sm:gap-3", footerClassName)}>
        {onCancel && (
          <DialogClose asChild>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={loading || disabled}
              className="text-xs sm:text-sm"
            >
              {cancelText}
            </Button>
          </DialogClose>
        )}
        {onConfirm && (
          <Button
            type={isForm ? "submit" : "button"}
            onClick={!isForm ? handleConfirm : undefined}
            disabled={loading || disabled}
            className="text-xs sm:text-sm"
          >
            {loading ? "Đang xử lý..." : confirmText}
          </Button>
        )}
      </DialogFooter>
    );
  };

  return (
    <div className={cn(className)}>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        {renderTrigger()}

        <DialogContent
          className={cn(sizeClasses[size], contentClassName)}
          onPointerDownOutside={
            closeMode === "default"
              ? closeOnOverlayClick
                ? undefined
                : (e) => e.preventDefault()
              : (e) => e.preventDefault()
          }
          onEscapeKeyDown={
            closeMode === "default"
              ? showCloseButton
                ? undefined
                : (e) => e.preventDefault()
              : (e) => e.preventDefault()
          }
        >
          <DialogContentWrapper
            onSubmit={isForm ? handleConfirm : undefined}
            className={isForm ? "space-y-4" : ""}
          >
            {renderHeader()}

            <div className="py-2 sm:py-4">{children}</div>

            {renderFooter()}
          </DialogContentWrapper>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default FlexibleDialog;
