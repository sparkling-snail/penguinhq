"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A vertical resize handle between the game canvas and the chat sidebar.
 * Drag left to make the chat panel wider, drag right to make it narrower.
 *
 * Uses document-level mousemove/mouseup listeners so dragging continues
 * even when the cursor moves far from the thin handle strip.
 */

const MIN_WIDTH = 280;
const MAX_WIDTH = 1200;
const DEFAULT_WIDTH = 360;

interface ResizeHandleProps {
  sidebarWidth: number;
  onWidthChange: (width: number) => void;
}

export function ResizeHandle({ sidebarWidth, onWidthChange }: ResizeHandleProps) {
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      // Dragging LEFT increases sidebar width (mouse moved left = negative delta)
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onWidthChange]);

  return (
    <div
      className="group relative hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center rounded-sm transition-colors hover:bg-penguin-accent/20 active:bg-penguin-accent/30 lg:flex"
      onMouseDown={onMouseDown}
    >
      {/* Visible grip dots */}
      <div className="flex flex-col gap-1">
        <div className="h-1 w-0.5 rounded-full bg-slate-600 transition-colors group-hover:bg-penguin-accent" />
        <div className="h-1 w-0.5 rounded-full bg-slate-600 transition-colors group-hover:bg-penguin-accent" />
        <div className="h-1 w-0.5 rounded-full bg-slate-600 transition-colors group-hover:bg-penguin-accent" />
      </div>
    </div>
  );
}

export { MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH };
