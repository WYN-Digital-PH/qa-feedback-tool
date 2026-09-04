import { useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, MessageSquare, MousePointer2 } from "lucide-react";
import { toast } from "sonner";

// Use the bundled worker (vite handles ?url)
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface Pin {
  id: string;
  pdf_page_number: number | null;
  x_percent: number;
  y_percent: number;
  comment: string;
  guest_name?: string | null;
  visibility?: "public" | "internal" | string;
}

interface Props {
  pdfUrl: string;
  mode: "browse" | "comment";
  setMode: (m: "browse" | "comment") => void;
  pins: Pin[];
  currentPage: number;
  setCurrentPage: (n: number) => void;
  onPinDrop: (page: number, xPct: number, yPct: number) => void;
  onPinClick?: (pinId: string) => void;
  commentingEnabled: boolean;
}

export default function PdfReviewCanvas({ pdfUrl, mode, setMode, pins, currentPage, setCurrentPage, onPinDrop, onPinClick, commentingEnabled }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.2);
  const pageWrapperRef = useRef<HTMLDivElement>(null);

  const pinsForPage = useMemo(() => pins.filter((p) => (p.pdf_page_number ?? 1) === currentPage), [pins, currentPage]);

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode !== "comment") return;
    if (!commentingEnabled) { toast.error("Commenting is closed"); return; }
    const target = e.currentTarget.querySelector("canvas") as HTMLCanvasElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) return;
    onPinDrop(currentPage, x, y);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-center gap-2 px-3 py-2 border-b border-border bg-card flex-wrap">
        <div className="flex bg-secondary rounded-md p-0.5">
          <button onClick={() => setMode("browse")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "browse" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
            <MousePointer2 className="w-3.5 h-3.5" /> Browse
          </button>
          <button onClick={() => setMode("comment")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "comment" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
            <MessageSquare className="w-3.5 h-3.5" /> Comment
          </button>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <Button size="sm" variant="ghost" onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground w-20 text-center">Page {currentPage} / {numPages || "?"}</span>
          <Button size="sm" variant="ghost" onClick={() => setCurrentPage(Math.min(numPages || currentPage, currentPage + 1))} disabled={!!numPages && currentPage >= numPages}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}><ZoomOut className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}><ZoomIn className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-secondary/40 p-4" data-review-capture>
        <div className="flex justify-center">
          <Document
            file={pdfUrl}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(e) => toast.error(`PDF load failed: ${e.message}`)}
            loading={<div className="text-sm text-muted-foreground p-8">Loading PDF…</div>}
          >
            <div
              ref={pageWrapperRef}
              className="relative inline-block"
              data-review-content
              style={{ cursor: mode === "comment" ? "crosshair" : "default" }}
              onClick={handlePageClick}
            >
              <Page pageNumber={currentPage} scale={zoom} renderAnnotationLayer={false} renderTextLayer={false} />
              {pinsForPage.map((pin, i) => {
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
          </Document>
        </div>
      </div>
    </div>
  );
}
