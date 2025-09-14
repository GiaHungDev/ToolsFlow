"use client";

import { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";


interface CustomSheetProps {
  title: ReactNode;
  content: ReactNode;
  footer: ReactNode;
  trigger: ReactNode;
  description?: ReactNode;
}

export function CSheet({
  title,
  content,
  footer,
  trigger,
  description,
}: CustomSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        {content}
        <SheetFooter>{footer}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
