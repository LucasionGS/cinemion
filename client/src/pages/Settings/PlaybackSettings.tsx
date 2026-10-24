import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { HardwareAcceleration, HardwareTestResult, PlaybackDevices, PlaybackSettings as Settings } from "@shared/playback.ts";
import PlaybackApi from "../../Api/PlaybackApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import Select from "../../components/Select/Select.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";

const METHODS: { kind: HardwareAcceleration; label: string | null; description: TranslationKey }[] = [
  { kind: "none", label: null, description: "settings.playback.methods.noneDescription" },
  { kind: "vaapi", label: "VA-API", description: "settings.playback.methods.vaapiDescription" },
  { kind: "qsv", label: "Intel Quick Sync", description: "settings.playback.methods.qsvDescription" },
  { kind: "nvenc", label: "NVIDIA NVENC", description: "settings.playback.methods.nvencDescription" },
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
    }).catch((e: Error) => toasts.error(t("settings.playback.couldntLoad"), e.message));
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
      toasts.success(t("settings.playback.saved"), t("settings.playback.savedDescription"));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
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
      toasts.success(t("settings.playback.cacheCleared"), t("settings.playback.cacheClearedDescription"));
    } catch (error) {
      toasts.error(t("settings.playback.couldntClear"), (error as Error).message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("settings.playback.title")}</h1>
          <p>{t("settings.playback.intro")}</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed}>{t("settings.playback.saveChanges")}</Button>
      </header>

      <section className="cn-settings__card">
        <h2>{t("settings.playback.hardware")}</h2>
        <div role="radiogroup" aria-label={t("settings.playback.hardware")} className="cn-playback__methods">
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
                  <strong>{method.label ?? t("settings.playback.methods.off")}</strong>
                  <span className="cn-playback__radio" />
                </span>
                <span className="cn-playback__method-text">{found?.available ? found.detail : t(method.description)}</span>
                <span className="cn-playback__method-state">
                  {method.kind === "none" ? t("settings.playback.alwaysAvailable") : !devices ? t("settings.playback.looking") : available ? t("settings.playback.detected") : t("settings.playback.notDetected")}
                </span>
              </button>
            );
          })}
        </div>

        {value.hardwareAcceleration !== "none" && (
          <div className="cn-playback__gpu">
            {value.hardwareAcceleration !== "nvenc" && (
              <Select
                label={t("settings.playback.gpu")}
                value={value.device}
                onChange={(e) => update({ device: e.target.value })}
                options={[...new Set([value.device, ...nodes])].map((n) => ({ value: n, label: n }))}
                description={t("settings.playback.gpuDescription", { flag: "--device /dev/dri" })}
              />
            )}
            <div className="cn-playback__codecs">
              <span className="cn-field__label">{t("settings.playback.decodeOnGpu")}</span>
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
              <span className="cn-field__description">{t("settings.playback.decodeDescription")}</span>
            </div>
            <div className="cn-settings__row">
              <Button variant="secondary" onClick={runTest} loading={testing}>{t("settings.playback.runTest")}</Button>
              {testing && <span className="cn-playback__test">{t("settings.playback.testing")}</span>}
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
        <h2>{t("settings.playback.converting")}</h2>
        <div className="cn-playback__fields">
          <Select
            label={t("settings.playback.maxConversions")}
            description={t("settings.playback.maxConversionsDescription")}
            value={String(value.maxConversions)}
            onChange={(e) => update({ maxConversions: Number(e.target.value) })}
            options={[1, 2, 3, 4, 6, 8, 12, 16].map((n) => ({ value: String(n), label: String(n) }))}
          />
          <Select
            label={t("settings.playback.preset")}
            description={t("settings.playback.presetDescription")}
            value={value.preset}
            onChange={(e) => update({ preset: e.target.value as Settings["preset"] })}
            options={[
              { value: "fast", label: t("settings.playback.presets.fast") },
              { value: "balanced", label: t("settings.playback.presets.balanced") },
              { value: "quality", label: t("settings.playback.presets.quality") },
            ]}
          />
          <Select
            label={t("settings.playback.remoteLimit")}
            description={t("settings.playback.remoteLimitDescription")}
            value={String(value.remoteMaxBitrate)}
            onChange={(e) => update({ remoteMaxBitrate: Number(e.target.value) })}
            options={[...new Set([...REMOTE_LIMITS, value.remoteMaxBitrate])].sort((a, b) => (b || Infinity) - (a || Infinity)).map((n) => ({ value: String(n), label: n === 0 ? t("settings.playback.noLimit") : t("format.bitrate.mbps", { value: n / 1_000_000 }) }))}
          />
        </div>
        <div className="cn-settings__divider" />
        <Switch label={t("settings.playback.toneMapping")} description={t("settings.playback.toneMappingDescription")} checked={value.toneMapping} onChange={(toneMapping) => update({ toneMapping })} />
        <Switch label={t("settings.playback.seekThumbnails")} description={t("settings.playback.seekThumbnailsDescription")} checked={value.seekThumbnails} onChange={(seekThumbnails) => update({ seekThumbnails })} />
        <Switch label={t("settings.playback.remoteConversion")} description={t("settings.playback.remoteConversionDescription")} checked={value.allowRemoteConversion} onChange={(allowRemoteConversion) => update({ allowRemoteConversion })} />
      </section>

      <section className="cn-settings__card">
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>{t("settings.playback.cache")}</strong>
            <span>{devices ? t("settings.playback.cacheDetails", { folder: devices.cacheDir, size: formatBytes(devices.cacheSize), thumbnails: formatBytes(devices.thumbnailsSize) }) : t("settings.playback.checking")}</span>
          </div>
          <Button variant="secondary" onClick={clearCache} loading={clearing}>{t("settings.playback.clearNow")}</Button>
        </div>
      </section>
    </>
  );
}
