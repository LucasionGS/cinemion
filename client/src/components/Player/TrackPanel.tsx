import { useEffect, useRef } from "react";
import { Check, Search, X } from "lucide-react";
import type { PlaybackInfo, QualityPreset } from "@shared/playback.ts";
import useController from "../../lib/useController.ts";
import { deviceMode } from "../../lib/DeviceMode.ts";
import cx from "../../lib/cx.ts";
import IconButton from "../IconButton/IconButton.tsx";
import Button from "../Button/Button.tsx";
import type { PanelTab, PlayerController } from "./PlayerController.ts";

export interface TrackPanelProps {
  controller: PlayerController;
}

interface Option {
  key: string;
  label: string;
  detail: string;
  active: boolean;
  onPick: () => void;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "subtitles", label: "Subtitles" },
  { id: "audio", label: "Audio" },
  { id: "quality", label: "Quality" },
];

const PRESETS: { id: Exclude<QualityPreset, "original">; height: number; detail: string }[] = [
  { id: "1080p", height: 1080, detail: "Up to 8 Mbps · converted" },
  { id: "720p", height: 720, detail: "Up to 4 Mbps · converted" },
  { id: "480p", height: 480, detail: "Up to 1.5 Mbps · converted" },
];

const CODECS: Record<string, string> = {
  h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", aac: "AAC", ac3: "Dolby Digital", eac3: "Dolby Digital Plus", opus: "Opus", mp3: "MP3", flac: "FLAC", dts: "DTS", truehd: "TrueHD",
};

function codec(name: string) {
  return CODECS[name] ?? name.toUpperCase();
}

function channels(count: number) {
  return count === 1 ? "mono" : count === 2 ? "stereo" : count === 6 ? "5.1" : count === 8 ? "7.1" : `${count} ch`;
}

/**
 * "Direct play", "Repackaged", "Converting" and so on, for the badge and the panel.
 */
export function modeLabel(info: PlaybackInfo) {
  if (info.mode === "direct") return "Direct play";
  if (info.mode === "remux") return "Repackaged";
  if (info.video.action === "copy") return "Converting audio";
  const gpu = info.video.hardware && info.video.hardware !== "none";
  return gpu ? "Converting on the GPU" : "Converting";
}

/**
 * The side panel with subtitle, audio and quality choices, and why the video is or isn't converted.
 */
export default function TrackPanel(props: TrackPanelProps) {
  const { controller } = props;
  const { info, item, panelTab, subtitleIndex } = useController(controller);
  const list = useRef<HTMLDivElement>(null);

  // Put focus on the chosen option when the panel or tab opens, so a remote starts in the right place
  useEffect(() => {
    if (!deviceMode.isTv()) return;
    const active = list.current?.querySelector<HTMLElement>("[aria-pressed=true]") ?? list.current?.querySelector<HTMLElement>("button");
    active?.focus({ preventScroll: true });
  }, [panelTab]);

  if (!info) return null;
  const file = item.files.find((f) => f.id === info.fileId) ?? item.files[0];
  let options: Option[] = [];

  if (panelTab === "subtitles") {
    options = [
      { key: "off", label: "Off", detail: "No subtitles", active: subtitleIndex === null, onPick: () => controller.setSubtitle(null) },
      ...info.subtitles.map((s) => ({ key: String(s.index), label: s.label, detail: s.detail, active: subtitleIndex === s.index, onPick: () => controller.setSubtitle(s.index) })),
    ];
  }
  else if (panelTab === "audio") {
    options = info.audio.map((a) => ({ key: String(a.index), label: a.label, detail: a.detail, active: info.audioIndex === a.index, onPick: () => controller.setAudio(a.index) }));
  }
  else {
    const height = file?.height ?? null;
    const original = [height ? `${height}p` : null, file?.hdr ? "HDR" : null, file?.videoCodec ? codec(file.videoCodec) : null].filter(Boolean).join(" · ");
    options = [
      { key: "original", label: "Original", detail: original || "As the file is", active: info.quality === "original", onPick: () => controller.setQuality("original") },
      ...PRESETS.filter((p) => !height || p.height < height * 0.95).map((p) => ({
        key: p.id,
        label: p.id,
        detail: p.detail,
        active: info.quality === p.id,
        onPick: () => controller.setQuality(p.id),
      })),
    ];
    if (item.files.length > 1) {
      options.push(...item.files.map((f, i) => ({
        key: `file-${f.id}`,
        label: `Version ${i + 1}${f.height ? ` · ${f.height}p` : ""}`,
        detail: [f.videoCodec ? codec(f.videoCodec) : null, f.hdr ? "HDR" : null, f.path.split(/[\\/]/).pop()].filter(Boolean).join(" · "),
        active: info.fileId === f.id,
        onPick: () => controller.setVersion(f.id),
      })));
    }
  }

  const stream = [
    info.video.height ? `${info.video.height}p` : null,
    info.video.action === "convert" && info.video.source !== info.video.codec ? `${codec(info.video.source)} → ${codec(info.video.codec)}` : codec(info.video.codec),
    info.video.hdr ? "HDR" : null,
    info.audioStream ? (info.audioStream.action === "convert" ? `${codec(info.audioStream.source)} → ${codec(info.audioStream.codec)} ${channels(info.audioStream.channels)}` : `${codec(info.audioStream.codec)} ${channels(info.audioStream.channels)}`) : null,
    info.video.bitrate ? `${Math.round(info.video.bitrate / 100_000) / 10} Mbps` : null,
  ].filter(Boolean).join(" · ");

  return (
    <aside className="cn-track-panel" aria-label="Playback options" data-focus-scope>
      <div className="cn-track-panel__header">
        <div role="tablist" aria-label="Options" className="cn-track-panel__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={panelTab === tab.id}
              className={cx("cn-track-panel__tab", panelTab === tab.id && "cn-track-panel__tab--active")}
              onClick={() => controller.setPanelTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <IconButton label="Close" icon={<X />} variant="ghost" size="sm" className="cn-track-panel__close" onClick={() => controller.closePanel()} />
      </div>
      <div ref={list} className="cn-track-panel__options" role="tabpanel">
        {options.length === 0 && <p className="cn-track-panel__empty">This file has no other audio tracks.</p>}
        {panelTab === "quality" && item.files.length > 1 && <span className="cn-track-panel__section">Quality</span>}
        {options.map((option, i) => (
          <OptionRow key={option.key} option={option} sectionBefore={panelTab === "quality" && item.files.length > 1 && option.key.startsWith("file-") && !options[i - 1]?.key.startsWith("file-") ? "Version" : null} />
        ))}
      </div>
      {panelTab === "subtitles" && info.canSearchSubtitles && (
        <div className="cn-track-panel__actions">
          <Button variant="secondary" icon={<Search />} block onClick={() => controller.setSubtitleSearchOpen(true)}>Search online</Button>
        </div>
      )}
      {panelTab === "quality" && (
        <div className="cn-track-panel__status">
          <strong className={cx("cn-track-panel__mode", `cn-track-panel__mode--${info.mode}`)}>{modeLabel(info)}</strong>
          <span>{stream}</span>
          {info.reasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      )}
    </aside>
  );
}

function OptionRow(props: { option: Option; sectionBefore: string | null }) {
  const { option, sectionBefore } = props;
  return (
    <>
      {sectionBefore && <span className="cn-track-panel__section">{sectionBefore}</span>}
      <button type="button" className="cn-track-panel__option" aria-pressed={option.active} onClick={option.onPick}>
        <span className="cn-track-panel__check">{option.active && <Check />}</span>
        <span className="cn-track-panel__text">
          <span>{option.label}</span>
          {option.detail && <small>{option.detail}</small>}
        </span>
      </button>
    </>
  );
}
