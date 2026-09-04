import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, MessageSquare, MousePointer2 } from "lucide-react";
import { toast } from "sonner";

interface Pin {
  id: string;
  x_percent: number;
  y_percent: number;
  comment: string;
  guest_name?: string | null;
  status?: string;
  visibility?: "public" | "internal" | string;
}

interface Props {
  imageUrl: string;
  mode: "browse" | "comment";
  setMode: (m: "browse" | "comment") => void;
  pins: Pin[];
  onPinDrop: (xPct: number, yPct: number) => void;
  onPinClick?: (pinId: string) => void;
  commentingEnabled: boolean;
}

export default function ImageReviewCanvas({ imageUrl, mode, setMode, pins, onPinDrop, onPinClick, commentingEnabled }: Props) {
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  function fitToScreen() {
    if (!containerRef.current || !naturalSize) return;
    const c = containerRef.current.getBoundingClientRect();
    const fit = Math.min((c.width - 32) / naturalSize.w, (c.height - 32) / naturalSize.h);
    setZoom(Math.max(0.1, Math.min(fit, 1)));
  }

  useEffect(() => { fitToScreen(); /* eslint-disable-next-line */ }, [naturalSize]);

  function handleClick(e: React.MouseEvent<HTMLImageElement>) {
    if (mode !== "comment") return;
    if (!commentingEnabled) { toast.error("Commenting is closed"); return; }
    const rect = (e.target as HTMLImageElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onPinDrop(x, y);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-center gap-2 px-3 py-2 border-b border-border bg-card">
        <div className="flex bg-secondary rounded-md p-0.5">
          <button onClick={() => setMode("browse")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "browse" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
            <MousePointer2 className="w-3.5 h-3.5" /> Browse
          </button>
          <button onClick={() => setMode("comment")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "comment" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
            <MessageSquare className="w-3.5 h-3.5" /> Comment
          </button>
        </div>
        <div className="flex items-center gap-1 ml-3">
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}><ZoomOut className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(4, z + 0.1))}><ZoomIn className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" onClick={fitToScreen}><Maximize2 className="w-4 h-4 mr-1" /> Fit</Button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto bg-secondary/40 flex items-start justify-center p-4" data-review-capture>
        <div className="relative inline-block" style={{ cursor: mode === "comment" ? "crosshair" : "default" }} data-review-content>
          <img
            ref={imgRef}
            src={imageUrl}
            alt="review"
            onLoad={(e) => {
              const t = e.target as HTMLImageElement;
              setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
            }}
            onClick={handleClick}
            draggable={false}
            style={{
              width: naturalSize ? naturalSize.w * zoom : undefined,
              height: naturalSize ? naturalSize.h * zoom : undefined,
              maxWidth: "none",
              userSelect: "none",
              boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
              background: "white",
            }}
          />
          {pins.map((pin, i) => {
            const isInternal = pin.visibility === "internal";
            return (
              <button
                key={pin.id}
                onClick={(e) => { e.stopPropagation(); onPinClick?.(pin.id); }}
                className={`absolute z-10 w-7 h-7 text-xs font-bold flex items-center justify-center shadow-lg border-2 border-white hover:scale-110 transition-transform ${isInternal ? "bg-warning text-warning-foreground" : "bg-primary text-primary-foreground"}`}
                style={{
                  left: `${pin.x_percent}%`,
                  top: `${pin.y_percent}%`,
                  transform: "translate(-50%, -100%)",
                  borderRadius: "999px 999px 999px 2px",
                }}
                title={(isInternal ? "[Internal] " : "") + pin.comment}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
