'use client';

import React, { useEffect, useState } from 'react';

interface Props {
  value: string;
  size?: number;
}

export default function DataMatrixComponent({ value, size = 200 }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function generate() {
      if (!value || value.trim().length === 0) {
        setSrc(null);
        return;
      }

      try {
        const bwipjsModule = await import('bwip-js');
        const bwipjs = (bwipjsModule as any).default || bwipjsModule;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        await bwipjs.toCanvas(canvas, {
          bcid: 'datamatrix',
          text: value,
          scale: Math.max(1, Math.floor(size / 36)),
          includetext: false,
          backgroundcolor: 'FFFFFF',
        });

        if (active) {
          setSrc(canvas.toDataURL('image/png'));
        }
      } catch (error) {
        console.error('[DataMatrixComponent] render_failed', error);
        if (active) {
          setSrc(null);
        }
      }
    }

    generate();

    return () => {
      active = false;
    };
  }, [size, value]);

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center bg-white text-[10px] text-gray-400"
      >
        DM
      </div>
    );
  }

  return <img src={src} alt="DataMatrix" width={size} height={size} />;
}
