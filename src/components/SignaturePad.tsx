import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SignaturePadProps {
  onSave: (signatureData: string) => void;
  onClear?: () => void;
  className?: string;
  disabled?: boolean;
  width?: number;
  height?: number;
  signerName?: string;
  initialData?: string;
}

export function SignaturePad({
  onSave,
  onClear,
  className,
  disabled = false,
  width = 400,
  height = 150,
  signerName,
  initialData,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#1a1a2e';
    context.fillStyle = '#1a1a2e';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (initialData) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setHasSignature(true);
      };
      image.src = initialData;
    } else {
      setHasSignature(false);
    }
  }, [initialData, width, height]);

  const getPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    canvas.setPointerCapture(event.pointerId);
    const { x, y } = getPoint(event);
    context.beginPath();
    context.arc(x, y, 1.25, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
    setIsDrawing(true);
    // A tap is a valid mark too; don't require a drag before enabling Confirm.
    setHasSignature(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;
    event.preventDefault();
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = getPoint(event);
    context.lineTo(x, y);
    context.stroke();
    context.beginPath();
    context.moveTo(x, y);
  };

  const finishDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onClear?.();
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature || disabled) return;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className={cn('w-full space-y-3', className)}>
      <div className="relative w-full">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          aria-label="Draw your signature"
          className={cn(
            'block h-auto w-full rounded-lg border-2 border-dashed bg-white touch-none',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair border-muted-foreground/30 hover:border-primary/50'
          )}
          style={{ aspectRatio: `${width} / ${height}`, touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrawing}
          onPointerCancel={finishDrawing}
        />
        {!hasSignature && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-muted-foreground">Sign here</span>
          </div>
        )}
        {signerName && <p className="mt-1 text-center text-sm text-muted-foreground">{signerName}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clearSignature} disabled={disabled || !hasSignature}>
          Clear
        </Button>
        <Button type="button" size="sm" onClick={saveSignature} disabled={disabled || !hasSignature}>
          Confirm Signature
        </Button>
      </div>
    </div>
  );
}
