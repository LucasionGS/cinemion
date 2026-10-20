import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { HardwareAcceleration, HardwareTestResult, PlaybackDevices, PlaybackSettings as Settings } from "@shared/playback.ts";
import PlaybackApi from "../../Api/PlaybackApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import Button from "../../components/Button/Button.tsx";
import Select from "../../components/Select/Select.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";

const METHODS: { kind: HardwareAcceleration; label: string; description: string }[] = [
  { kind: "none", label: "Off", description: "Convert on the CPU. Works everywhere, but 4K is slow." },
  { kind: "vaapi", label: "VA-API", description: "Intel and AMD graphics on Linux." },
  { kind: "qsv", label: "Intel Quick Sync", description: "Intel graphics, often a little faster than VA-API." },
  { kind: "nvenc", label: "NVIDIA NVENC", description: "NVIDIA graphics cards." },
];

const DECODE_CODECS = [
  { codec: "h264", label: "H.264" },
  { codec: "hevc", label: "HEVC" },
  { codec: "vp9", label: "VP9" },
  { codec: "av1", label: "AV1" },
  { codec: "mpeg2video", label: "MPEG-2" },
  { codec: "vc1", label: "VC-1" },
];

const REMOTE_LIMITS = [0, 20_000_000, 12_000_000, 8_000_000, 4_000_000, 2_000_000];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * How the server converts video: GPU acceleration, limits and the conversion cache.
 */
export default function PlaybackSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [value, setValue] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<PlaybackDevices | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<HardwareTestResult | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    PlaybackApi.getSettings().then((s) => {
      setSaved(s);
      setValue(s);
    }).catch((e: Error) => toasts.error("Couldn't load playback settings", e.message));
    PlaybackApi.devices().then(setDevices).catch(() => { });
  }, []);

  if (!value) return <Spinner size="2rem" />;

  const changed = JSON.stringify(saved) !== JSON.stringify(value);
  const update = (patch: Partial<Settings>) => setValue({ ...value, ...patch });
  const nodes = [...new Set(devices?.devices.filter((d) => d.device).map((d) => d.device!) ?? [])];

  function pick(kind: HardwareAcceleration) {
    // Point at a detected GPU when the saved one doesn't exist here
    const match = devices?.devices.find((d) => d.kind === kind && d.device);
    update({ hardwareAcceleration: kind, device: match && !nodes.includes(value!.device) ? match.device! : value!.device });
    setTest(null);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await PlaybackApi.setSettings(value!);
      setSaved(result);
      setValue(result);
      toasts.success("Playback settings saved", "They apply to videos started from now on.");
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await PlaybackApi.test(value!.hardwareAcceleration, value!.device));
    } catch (error) {
      setTest({ ok: false, speed: null, message: (error as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function clearCache() {
    setClearing(true);
    try {
      const { cacheSize } = await PlaybackApi.clearCache();
      setDevices((d) => d && { ...d, cacheSize });
      toasts.success("Conversion cache cleared", "Anyone watching a converted video has to start it again.");
    } catch (error) {
      toasts.error("Couldn't clear the cache", (error as Error).message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Playback</h1>
          <p>How Cinemion converts videos for devices that can't play the original file.</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed}>Save changes</Button>
      </header>

      <section className="cn-settings__card">
        <h2>Hardware acceleration</h2>
        <div role="radiogroup" aria-label="Hardware acceleration" className="cn-playback__methods">
          {METHODS.map((method) => {
            const found = method.kind === "none" ? null : devices?.devices.find((d) => d.kind === method.kind);
            const available = method.kind === "none" || !!found?.available;
            const checked = value.hardwareAcceleration === method.kind;
            return (
              <button
                key={method.kind}
                type="button"
                role="radio"
                aria-checked={checked}
                className={cx("cn-playback__method", checked && "cn-playback__method--checked", !available && "cn-playback__method--missing")}
                onClick={() => pick(method.kind)}
              >
                <span className="cn-playback__method-head">
                  <strong>{method.label}</strong>
                  <span className="cn-playback__radio" />
                </span>
                <span className="cn-playback__method-text">{found?.available ? found.detail : method.description}</span>
                <span className="cn-playback__method-state">
                  {method.kind === "none" ? "Always available" : !devices ? "Looking…" : available ? "Detected" : "Not detected"}
                </span>
              </button>
            );
          })}
        </div>

        {value.hardwareAcceleration !== "none" && (
          <div className="cn-playback__gpu">
            {value.hardwareAcceleration !== "nvenc" && (
              <Select
                label="GPU"
                value={value.device}
                onChange={(e) => update({ device: e.target.value })}
                options={[...new Set([value.device, ...nodes])].map((n) => ({ value: n, label: n }))}
                description="The render device. In Docker, pass it in with --device /dev/dri."
              />
            )}
            <div className="cn-playback__codecs">
              <span className="cn-field__label">Decode these on the GPU</span>
              <div className="cn-playback__chips">
                {DECODE_CODECS.map(({ codec, label }) => {
                  const on = value.hardwareDecodeCodecs.includes(codec);
                  return (
                    <button
                      key={codec}
                      type="button"
                      aria-pressed={on}
                      className={cx("cn-playback__chip", on && "cn-playback__chip--on")}
                      onClick={() => update({ hardwareDecodeCodecs: on ? value.hardwareDecodeCodecs.filter((c) => c !== codec) : [...value.hardwareDecodeCodecs, codec] })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="cn-field__description">Turn off codecs your GPU can't decode; they're decoded on the CPU and still converted on the GPU.</span>
            </div>
            <div className="cn-settings__row">
              <Button variant="secondary" onClick={runTest} loading={testing}>Run a test</Button>
              {testing && <span className="cn-playback__test">Converting a 5 second 1080p clip…</span>}
              {test && (
                <span className={cx("cn-playback__test", test.ok ? "cn-playback__test--ok" : "cn-playback__test--failed")}>
                  {test.ok ? <CircleCheck /> : <CircleAlert />}
                  {test.message}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="cn-settings__card">
        <h2>Converting</h2>
        <div className="cn-playback__fields">
          <Select
            label="Simultaneous conversions"
            description="More than this are turned away until one stops. Direct play and repackaging don't count."
            value={String(value.maxConversions)}
            onChange={(e) => update({ maxConversions: Number(e.target.value) })}
            options={[1, 2, 3, 4, 6, 8, 12, 16].map((n) => ({ value: String(n), label: String(n) }))}
          />
          <Select
            label="Quality preset"
            description="Faster presets use less CPU but look a little worse at the same bitrate."
            value={value.preset}
            onChange={(e) => update({ preset: e.target.value as Settings["preset"] })}
            options={[{ value: "fast", label: "Fast" }, { value: "balanced", label: "Balanced" }, { value: "quality", label: "Quality" }]}
          />
          <Select
            label="Remote stream limit"
            description="Per stream, for viewers outside your home network."
            value={String(value.remoteMaxBitrate)}
            onChange={(e) => update({ remoteMaxBitrate: Number(e.target.value) })}
            options={[...new Set([...REMOTE_LIMITS, value.remoteMaxBitrate])].sort((a, b) => (b || Infinity) - (a || Infinity)).map((n) => ({ value: String(n), label: n === 0 ? "No limit" : `${n / 1_000_000} Mbps` }))}
          />
        </div>
        <div className="cn-settings__divider" />
        <Switch label="Tone-map HDR to SDR" description="Keeps colours right on screens without HDR." checked={value.toneMapping} onChange={(toneMapping) => update({ toneMapping })} />
        <Switch label="Make seek thumbnails" description="Small pictures above the seek bar. Made in the background after a scan, and when a video is first played." checked={value.seekThumbnails} onChange={(seekThumbnails) => update({ seekThumbnails })} />
        <Switch label="Allow conversion for remote viewers" description="Off means viewers outside your network only get files their device plays as they are." checked={value.allowRemoteConversion} onChange={(allowRemoteConversion) => update({ allowRemoteConversion })} />
      </section>

      <section className="cn-settings__card">
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>Conversion cache</strong>
            <span>{devices ? `${devices.cacheDir} · ${formatBytes(devices.cacheSize)} · cleaned up when playback stops. Seek thumbnails use ${formatBytes(devices.thumbnailsSize)}.` : "Checking…"}</span>
          </div>
          <Button variant="secondary" onClick={clearCache} loading={clearing}>Clear now</Button>
        </div>
      </section>
    </>
  );
}
