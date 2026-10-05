// One example, running: a canvas over the example's build-time still, the example's own setup
// on it, and a toolbar of Ant Design controls under it (the status, the samples a pixel, the
// frame time; pause, reset the view, save a PNG, full screen). The still is drawn by the page
// (Stage.astro) under this island, so a browser with no WebGPU or no script still shows the
// picture. `compact` is the front page's form: the status floats over the canvas, no toolbar.

import { useEffect, useRef, useState } from 'react';
import { Button, ConfigProvider, Tag, Tooltip, theme as antd } from 'antd';
import { Download, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import { exampleById } from '../../examples/index.ts';
import type { ExampleRun } from '../../examples/types.ts';

export interface StageCopy {
  rendering: string;
  preview: string;
  paused: string;
  done: string;
  error: string;
  samples: string;
  frameTime: string;
  pause: string;
  resume: string;
  resetView: string;
  png: string;
  fullscreen: string;
  exitFullscreen: string;
  noWebgpu: string;
  canvasLabel: string;
}

interface Stats {
  samples: number;
  frameTime: number | undefined;
  preview: boolean;
}

const ICON = { size: 16, strokeWidth: 1.5 } as const;

/** Whether the page is dark now, following Starlight's theme switch. */
function useDark(): boolean {
  const read = (): boolean => document.documentElement.dataset.theme === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Ant Design in DESIGN.md's tokens: Pretendard, an 8px radius, 32px controls, Vapor's blue. */
function themeFor(dark: boolean) {
  return {
    algorithm: dark ? antd.darkAlgorithm : antd.defaultAlgorithm,
    token: {
      fontFamily: "'Pretendard Variable', Pretendard, system-ui, sans-serif",
      fontSize: 14,
      borderRadius: 8,
      borderRadiusSM: 8,
      controlHeight: 32,
      controlHeightSM: 24,
      colorPrimary: dark ? '#368aed' : '#2a72e5',
      colorText: dark ? '#fafafa' : '#262626',
      colorTextSecondary: dark ? '#bebebe' : '#4c4c4c',
      colorBorder: dark ? '#6c6c6c' : '#c6c6c6',
      colorBgContainer: dark ? '#363636' : '#ffffff',
      colorBgElevated: dark ? '#363636' : '#ffffff',
      boxShadowSecondary: '0 4px 10px rgba(0, 0, 0, 0.2)',
      motionDurationMid: '0.15s',
    },
    components: {
      Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
      Tooltip: { colorBgSpotlight: dark ? '#606060' : '#393939' },
    },
  };
}

async function savePng(run: ExampleRun, name: string): Promise<void> {
  const r = run.renderer;
  const texels = await r.readPixels();
  const out = document.createElement('canvas');
  out.width = r.width;
  out.height = r.height;
  const ctx = out.getContext('2d')!;
  const image = ctx.createImageData(r.width, r.height);
  for (let i = 0; i < texels.length; i++)
    image.data[i] = Math.round(Math.min(1, Math.max(0, texels[i]!)) * 255);
  ctx.putImageData(image, 0, 0);
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.download = `${name}-${r.samples}spp.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

export default function ExampleStage(props: { id: string; copy: StageCopy; compact?: boolean }) {
  const { id, copy, compact = false } = props;
  const dark = useDark();
  const holder = useRef<HTMLDivElement>(null);
  const run = useRef<ExampleRun | undefined>(undefined);
  const [stats, setStats] = useState<Stats>({ samples: 0, frameTime: undefined, preview: false });
  const [error, setError] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [full, setFull] = useState(false);
  const [running, setRunning] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const entry = exampleById(id);
    if (!entry) {
      setError(`No example called ${id}.`);
      return;
    }
    if (!('gpu' in navigator)) {
      setError(copy.noWebgpu);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', copy.canvasLabel);
    canvas.className =
      'absolute inset-0 block h-full w-full cursor-grab outline-none active:cursor-grabbing';
    holder.current!.replaceChildren(canvas);
    entry
      .load()
      .then((m) => m.default(canvas))
      .then((r) => {
        if (stopped) {
          r.dispose();
          return;
        }
        run.current = r;
        setRunning(true);
        setAnimated(r.playing !== undefined);
        timer = window.setInterval(() => {
          const t = r.renderer;
          if (t.samples > 0) setDrawn(true);
          setStats({
            samples: t.samples,
            frameTime: t.info.frames > 0 ? t.info.frameTime : undefined,
            preview: t.scale !== 1,
          });
        }, 200);
      })
      .catch((e: unknown) => {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stopped = true;
      clearInterval(timer);
      run.current?.dispose();
      run.current = undefined;
    };
  }, [id]);

  // Pause stops what moves: an example's motion when it has one (the frame then refines), the
  // path tracer's samples otherwise.
  useEffect(() => {
    const r = run.current;
    if (!r) return;
    if (r.playing !== undefined) r.playing = !paused;
    else r.renderer.paused = paused;
  }, [paused]);

  useEffect(() => {
    const onChange = (): void =>
      setFull(
        document.fullscreenElement !== null &&
          document.fullscreenElement === stageOf(holder.current),
      );
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const status = error
    ? copy.error
    : stats.preview
      ? copy.preview
      : paused
        ? copy.paused
        : copy.rendering;
  const colour = error ? 'error' : status === copy.rendering ? 'processing' : 'default';
  const count = (
    <span className="rd-num text-[12px] leading-[18px]">
      {stats.samples} {copy.samples}
      {stats.frameTime !== undefined && (
        <span className="text-hint">
          {' '}
          / {stats.frameTime.toFixed(1)} {copy.frameTime}
        </span>
      )}
    </span>
  );

  // The island's elements join the stage's grid (Stage.astro): the canvas over the still in the
  // first row, the toolbar over its placeholder in the second. astro-island is display: contents.
  return (
    <ConfigProvider theme={themeFor(dark)}>
      <div className="relative col-start-1 row-start-1 min-h-0">
        {/* The canvas stays clear until its first frame is drawn, so the still shows under it
            until then; after that it stays, through a preview's restart too. */}
        <div
          ref={holder}
          className={`absolute inset-0 transition-opacity duration-150 ${drawn ? 'opacity-100' : 'opacity-0'}`}
          data-running={running ? '' : undefined}
          data-drawn={drawn ? '' : undefined}
        />
        {error !== undefined && (
          <p
            role="status"
            className="absolute inset-x-3 bottom-3 m-0 rounded-[8px] bg-overlay px-3 py-2 text-[12px] leading-[18px] text-fg shadow-[0_4px_10px_rgb(0_0_0/0.2)]"
          >
            {error}
          </p>
        )}
        {compact && error === undefined && (
          <div
            className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-[8px] bg-overlay px-2 py-1 text-fg shadow-[0_4px_10px_rgb(0_0_0/0.2)]"
            data-samples={stats.samples}
            data-status={status}
          >
            <Tag variant="filled" color={colour} className="m-0">
              {status}
            </Tag>
            {count}
          </div>
        )}
      </div>
      {!compact && (
        <div
          className="col-start-1 row-start-2 flex min-h-12 flex-wrap items-center gap-2 border-t border-hairline bg-overlay px-3 py-1 text-fg"
          data-stage-toolbar
          data-animated={animated ? '' : undefined}
          data-samples={stats.samples}
          data-status={status}
        >
          <Tag variant="filled" color={colour} className="m-0">
            {status}
          </Tag>
          {count}
          <div className="ml-auto flex gap-1">
            <Tooltip title={paused ? copy.resume : copy.pause}>
              <Button
                type="text"
                aria-label={paused ? copy.resume : copy.pause}
                icon={paused ? <Play {...ICON} /> : <Pause {...ICON} />}
                onClick={() => setPaused((p) => !p)}
                disabled={!running}
              />
            </Tooltip>
            <Tooltip title={copy.resetView}>
              <Button
                type="text"
                aria-label={copy.resetView}
                icon={<RotateCcw {...ICON} />}
                onClick={() => run.current?.controls?.reset()}
                disabled={!running}
              />
            </Tooltip>
            <Tooltip title={copy.png}>
              <Button
                type="text"
                aria-label={copy.png}
                icon={<Download {...ICON} />}
                onClick={() => run.current && void savePng(run.current, id)}
                disabled={!running}
              />
            </Tooltip>
            <Tooltip title={full ? copy.exitFullscreen : copy.fullscreen}>
              <Button
                type="text"
                aria-label={full ? copy.exitFullscreen : copy.fullscreen}
                icon={full ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
                onClick={() =>
                  full
                    ? void document.exitFullscreen()
                    : void stageOf(holder.current)?.requestFullscreen()
                }
              />
            </Tooltip>
          </div>
        </div>
      )}
    </ConfigProvider>
  );
}

/** The stage element (Stage.astro) an island's element sits in. */
function stageOf(el: HTMLElement | null): HTMLElement | null {
  return el?.closest('[data-stage]') ?? null;
}
