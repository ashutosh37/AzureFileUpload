import React, { useRef, useEffect, useState, useCallback } from "react";
import type { DisplayItem } from "../../src/interfaces";
import * as pdfjsLib from "pdfjs-dist";
// import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url"; // Removed this import

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfRedactorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    redactionCoordinates: {
      x: number;
      y: number;
      width: number;
      height: number;
      page: number;
    }[]
  ) => void;
  pdfFile: DisplayItem | null;
  pdfUrl: string | null; // New prop for the SAS URL
}

export const PdfRedactorDialog: React.FC<PdfRedactorDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  pdfFile,
  pdfUrl,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null); // PDF.js PDFDocumentProxy
  const [currentPage, setCurrentPage] = useState(1);
  const [redactionRects, setRedactionRects] = useState<
    {
      x: number;
      y: number;
      width: number;
      height: number;
      page: number;
    }[]
  >([]);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [currentRect, setCurrentRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const renderTaskRef = useRef<any>(null);

  // Load PDF when dialog opens or pdfUrl changes
  useEffect(() => {
    if (isOpen && pdfUrl) {
      const loadingTask = pdfjsLib.getDocument(pdfUrl); // Use pdfUrl for loading
      loadingTask.promise
        .then((pdf: any) => {
          setPdfDoc(pdf);
          setCurrentPage(1); // Reset to first page when new PDF loads
          setRedactionRects([]); // Clear previous redactions
        })
        .catch((error: any) => {
          console.error("Error loading PDF:", error);
          // Handle error, maybe show a message to the user
        });
    } else if (!isOpen) {
      setPdfDoc(null);
      setRedactionRects([]);
    }
  }, [isOpen, pdfUrl]);

  // Replace the existing renderPage function with this more robust version:
  const renderPage = useCallback(async () => {
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    if (!pdfDoc || !canvasRef.current) return;

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    const task = page.render(renderContext);
    renderTaskRef.current = task;

    try {
      await task.promise;
      renderTaskRef.current = null; // Clear ref on success

      // Draw existing redaction rectangles
      context.strokeStyle = "red";
      context.lineWidth = 2;
      context.fillStyle = "rgba(0, 0, 0, 0.7)";

      redactionRects
        .filter((rect) => rect.page === currentPage)
        .forEach((rect) => {
          context.fillRect(rect.x, rect.y, rect.width, rect.height);
          context.strokeRect(rect.x, rect.y, rect.width, rect.height);
        });

      // Draw current drawing rectangle
      if (currentRect) {
        context.fillRect(
          currentRect.x,
          currentRect.y,
          currentRect.width,
          currentRect.height
        );
        context.strokeRect(
          currentRect.x,
          currentRect.y,
          currentRect.width,
          currentRect.height
        );
      }
    } catch (error: any) {
      renderTaskRef.current = null; // Clear ref on failure
      // Don't log the error if it's a rendering cancellation
      if (error.name !== "RenderingCancelledException") {
        console.error("Error rendering page:", error);
      }
    }
  }, [pdfDoc, currentPage, redactionRects, currentRect]);

  // Add this useEffect for cleanup when the component unmounts
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, []);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    setIsDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setStartPoint({ x, y });
    setCurrentRect({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newX = Math.min(x, startPoint.x);
    const newY = Math.min(y, startPoint.y);
    const newWidth = Math.abs(x - startPoint.x);
    const newHeight = Math.abs(y - startPoint.y);

    setCurrentRect({ x: newX, y: newY, width: newWidth, height: newHeight });
    renderPage(); // Re-render to show the rectangle being drawn
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    if (currentRect) {
      setRedactionRects((prev) => [
        ...prev,
        { ...currentRect, page: currentPage },
      ]);
      setCurrentRect(null);
    }
  };

  const handleClearRedactions = () => {
    setRedactionRects([]);
    renderPage();
  };

  const handleSave = () => {
    onSave(redactionRects);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
      <div className="bg-white p-4 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <h2 className="text-xl font-bold mb-4">
          Redact PDF: {pdfFile?.displayName}
        </h2>

        <div className="flex-grow overflow-hidden flex flex-col items-center">
          <div className="flex justify-between w-full mb-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
            >
              Previous Page
            </button>
            <span>
              Page {currentPage} of {pdfDoc?.numPages || 0}
            </span>
            <button
              onClick={() =>
                setCurrentPage((prev) =>
                  Math.min(pdfDoc?.numPages || 1, prev + 1)
                )
              }
              disabled={currentPage === (pdfDoc?.numPages || 1)}
              className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
            >
              Next Page
            </button>
          </div>
          <div className="relative border overflow-auto flex-grow w-full flex justify-center items-center">
            <canvas
              ref={canvasRef}
              className="border border-gray-300"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp} // End drawing if mouse leaves canvas
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 mt-4">
          <button
            onClick={handleClearRedactions}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            Clear Redactions
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            disabled={redactionRects.length === 0}
          >
            Save Redactions
          </button>
        </div>
      </div>
    </div>
  );
};
