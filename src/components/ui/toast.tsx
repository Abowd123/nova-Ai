"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva } from "class-variance-authority";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useToastStore } from "./use-toast";

const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl p-4 pe-10 shadow-elevation2 data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full data-[swipe=end]:animate-out",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background",
        success: "bg-success text-success-foreground",
        destructive: "bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Toaster() {
  const { toasts, dismiss, remove } = useToastStore();
  const { t, dir } = useI18n();

  return (
    <ToastPrimitive.Provider swipeDirection={dir === "rtl" ? "left" : "right"} duration={5000}>
      {toasts.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          open={item.open}
          duration={item.duration}
          type={item.variant === "destructive" ? "foreground" : "background"}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(item.id);
              window.setTimeout(() => remove(item.id), 300);
            }
          }}
          className={cn(toastVariants({ variant: item.variant }))}
        >
          <div className="grid flex-1 gap-1">
            <ToastPrimitive.Title className="text-sm font-semibold">{item.title}</ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="text-sm opacity-90">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {item.action ? (
            <ToastPrimitive.Action altText={item.action.label} asChild>
              <Button size="sm" variant="tonal" onClick={item.action.onClick}>
                {item.action.label}
              </Button>
            </ToastPrimitive.Action>
          ) : null}
          <ToastPrimitive.Close
            aria-label={t.common.close}
            className="absolute end-2 top-2 rounded-full p-1.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-24 end-4 z-[100] flex max-h-screen w-[calc(100%-2rem)] max-w-sm flex-col gap-2 outline-none md:bottom-4" />
    </ToastPrimitive.Provider>
  );
}
