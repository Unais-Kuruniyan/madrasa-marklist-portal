import { useEffect, useRef } from 'react';
import type { PreparedImage } from '../../lib/import/image';
import type { BoundingBox } from '../../lib/import/types';
import { useTranslation } from '../../i18n/context';
import { Button } from '../ui/Button';
import { XIcon } from '../ui/Icons';

interface SourceCropModalProps {
  image: PreparedImage;
  box?: BoundingBox | null;
  title: string;
  detectedValue: string | number | null;
  onClose: () => void;
}

/**
 * Image Cell Verification Modal (Section 16).
 * Renders a cropped & magnified Canvas view of the region in the uploaded photo
 * alongside the full image with bounding box highlight.
 * Held purely in browser RAM (never stored anywhere).
 */
export function SourceCropModal({ image, box, title, detectedValue, onClose }: SourceCropModalProps) {
  const { t } = useTranslation();
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.src = image.previewUrl;
    img.onload = () => {
      const w = img.naturalWidth || image.width;
      const h = img.naturalHeight || image.height;

      // Normalized coordinates [ymin, xmin, ymax, xmax] in 0..1000 scale
      const defaultBox: BoundingBox = [0, 0, 1000, 1000];
      const targetBox = box && box.length === 4 ? box : defaultBox;
      const [ymin, xmin, ymax, xmax] = targetBox;

      const sx = Math.floor((xmin / 1000) * w);
      const sy = Math.floor((ymin / 1000) * h);
      const sw = Math.max(10, Math.ceil(((xmax - xmin) / 1000) * w));
      const sh = Math.max(10, Math.ceil(((ymax - ymin) / 1000) * h));

      // 1. Draw Cropped Region
      const cropCanvas = cropCanvasRef.current;
      if (cropCanvas) {
        // Add padding around crop for visual context
        const padX = Math.round(sw * 0.3);
        const padY = Math.round(sh * 0.4);
        const csx = Math.max(0, sx - padX);
        const csy = Math.max(0, sy - padY);
        const csw = Math.min(w - csx, sw + padX * 2);
        const csh = Math.min(h - csy, sh + padY * 2);

        cropCanvas.width = csw;
        cropCanvas.height = csh;
        const ctx = cropCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, csw, csh);
          ctx.drawImage(img, csx, csy, csw, csh, 0, 0, csw, csh);

          // Highlight target area inside padded canvas
          const relX = sx - csx;
          const relY = sy - csy;
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = Math.max(2, Math.round(csw / 150));
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(relX, relY, sw, sh);
        }
      }

      // 2. Draw Full Image with Overlay Box
      const fullCanvas = fullCanvasRef.current;
      if (fullCanvas) {
        const maxDisplayW = 800;
        const scale = Math.min(1, maxDisplayW / w);
        const fw = Math.round(w * scale);
        const fh = Math.round(h * scale);
        fullCanvas.width = fw;
        fullCanvas.height = fh;
        const ctx = fullCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, fw, fh);
          if (box) {
            const bx = Math.round((xmin / 1000) * fw);
            const by = Math.round((ymin / 1000) * fh);
            const bw = Math.round(((xmax - xmin) / 1000) * fw);
            const bh = Math.round(((ymax - ymin) / 1000) * fh);

            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 3;
            ctx.strokeRect(bx, by, bw, bh);
          }
        }
      }
    };
  }, [image, box]);

  return (
    <dialog
      open
      aria-labelledby="source-crop-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h3 id="source-crop-title" className="text-lg font-bold text-slate-900">
              {t('photoImport.viewSourceArea')}
            </h3>
            <p className="text-xs text-slate-500">{title}</p>
          </div>
          <Button variant="ghost" size="sm" icon={<XIcon className="size-4" />} onClick={onClose} aria-label={t('common.cancel')}>
            {t('common.cancel')}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Zoomed / Cropped Region */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              {t('photoImport.croppedRegion')}
            </p>
            <div className="flex items-center justify-center overflow-auto max-h-48 rounded bg-white p-2 border border-slate-200">
              <canvas ref={cropCanvasRef} className="max-w-full object-contain" />
            </div>
            <div className="rounded bg-brand-50 p-2 text-xs font-semibold text-brand-900 flex justify-between items-center">
              <span>{t('photoImport.detectedValue')}:</span>
              <span className="text-base font-bold tabular-nums text-slate-900">{detectedValue ?? '—'}</span>
            </div>
          </div>

          {/* Full Page Context */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              {t('photoImport.fullDocumentContext')}
            </p>
            <div className="overflow-auto max-h-48 rounded bg-white border border-slate-200">
              <canvas ref={fullCanvasRef} className="w-full object-contain" />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
