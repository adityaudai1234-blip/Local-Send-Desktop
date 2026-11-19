import React, { useMemo, useState } from 'react';
import { Activity, Pause, Play, Trash2 } from 'lucide-react';
import type { ThroughputHistoryPoint } from '../../types/performance';
import { formatSpeed } from '../../utils/formatters';

interface ThroughputGraphProps {
  points: ThroughputHistoryPoint[];
  currentUploadBps: number;
  currentDownloadBps: number;
  peakSpeedBps: number;
  paused: boolean;
  onTogglePause: () => void;
  onClear?: () => void;
}

export const ThroughputGraph: React.FC<ThroughputGraphProps> = ({
  points,
  currentUploadBps,
  currentDownloadBps,
  peakSpeedBps,
  paused,
  onTogglePause,
  onClear,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 760;
  const height = 160;
  const padX = 8;
  const padY = 12;

  const { maxVal, uploadPath, uploadArea, downloadPath, downloadArea, coords } = useMemo(() => {
    if (points.length === 0) {
      return {
        maxVal: 1024 * 1024,
        uploadPath: '',
        uploadArea: '',
        downloadPath: '',
        downloadArea: '',
        coords: [] as Array<{ x: number; yUp: number; yDown: number; pt: ThroughputHistoryPoint }>,
      };
    }

    const peakInWindow = points.reduce(
      (m, p) => Math.max(m, p.uploadBps, p.downloadBps),
      1024 * 1024
    );
    const maxScale = Math.max(peakInWindow * 1.15, 1024 * 1024);
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;

    const pts = points.map((pt, i) => {
      const x = points.length === 1 ? width / 2 : padX + i * step;
      const yUp = padY + innerH - (pt.uploadBps / maxScale) * innerH;
      const yDown = padY + innerH - (pt.downloadBps / maxScale) * innerH;
      return { x, yUp, yDown, pt };
    });

    const buildLine = (key: 'yUp' | 'yDown') =>
      pts.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c[key].toFixed(1)}`).join(' ');

    const buildArea = (key: 'yUp' | 'yDown') => {
      if (pts.length === 0) return '';
      const baseLine = height - padY;
      return `${buildLine(key)} L ${pts[pts.length - 1].x.toFixed(1)} ${baseLine} L ${pts[0].x.toFixed(1)} ${baseLine} Z`;
    };

    return {
      maxVal: maxScale,
      uploadPath: buildLine('yUp'),
      uploadArea: buildArea('yUp'),
      downloadPath: buildLine('yDown'),
      downloadArea: buildArea('yDown'),
      coords: pts,
    };
  }, [points]);

  const hovered = hoverIdx !== null && coords[hoverIdx] ? coords[hoverIdx] : null;

  return (
    <div className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
            <Activity className="w-4 h-4 text-cyan-500" />
            <span>Real-Time Throughput</span>
            <span className="text-xs font-normal text-neutral-500">
              {paused ? '· Paused' : '· Live 60-sample window'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 font-mono tabular-nums">
            <span className="text-cyan-600 dark:text-cyan-400">
              Upload {formatSpeed(hovered ? hovered.pt.uploadBps : currentUploadBps)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              Download {formatSpeed(hovered ? hovered.pt.downloadBps : currentDownloadBps)}
            </span>
            <span aria-hidden="true">·</span>
            <span>Peak {formatSpeed(peakSpeedBps)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onTogglePause}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{paused ? 'Resume Graph' : 'Pause Graph'}</span>
          </button>

          {onClear && points.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              title="Clear graph samples"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="h-36 rounded-lg border border-dashed border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-xs text-neutral-500">
          Start an upload or incoming transfer to stream live LAN throughput samples.
        </div>
      ) : (
        <div className="relative">
          <div className="flex justify-between text-[10px] font-mono tabular-nums text-neutral-400 mb-1">
            <span>Scale: {formatSpeed(maxVal)}</span>
            <span>0 B/s</span>
          </div>

          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-36 overflow-visible select-none"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Subtle horizontal reference gridlines */}
            {[0.25, 0.5, 0.75].map((ratio) => {
              const y = padY + (height - padY * 2) * ratio;
              return (
                <line
                  key={ratio}
                  x1={padX}
                  x2={width - padX}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                  strokeDasharray="3 3"
                />
              );
            })}

            <path d={downloadArea} fill="#10b981" fillOpacity={0.12} />
            <path d={uploadArea} fill="#06b6d4" fillOpacity={0.14} />

            <path
              d={downloadPath}
              fill="none"
              stroke="#10b981"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <path
              d={uploadPath}
              fill="none"
              stroke="#06b6d4"
              strokeWidth={2}
              strokeLinejoin="round"
            />

            {hovered && (
              <>
                <line
                  x1={hovered.x}
                  x2={hovered.x}
                  y1={padY}
                  y2={height - padY}
                  stroke="currentColor"
                  strokeOpacity={0.25}
                />
                <circle cx={hovered.x} cy={hovered.yUp} r={3.5} fill="#06b6d4" />
                <circle cx={hovered.x} cy={hovered.yDown} r={3.5} fill="#10b981" />
              </>
            )}

            {/* Invisible interactive hover bands per sample */}
            {coords.map((c, idx) => (
              <rect
                key={c.pt.timestamp + '-' + idx}
                x={Math.max(0, c.x - 8)}
                y={0}
                width={16}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
};
