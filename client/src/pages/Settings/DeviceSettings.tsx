import { deviceMode, type ModeSetting } from "../../lib/DeviceMode.ts";
import { devicePrefs, type SkipIntros, type Speakers } from "../../lib/DevicePrefs.ts";
import useController from "../../lib/useController.ts";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Select from "../../components/Select/Select.tsx";

const SPEAKERS: { value: Speakers; label: string }[] = [
  { value: "auto", label: "Automatic (surround on TVs, stereo elsewhere)" },
  { value: "stereo", label: "Stereo" },
  { value: "surround51", label: "5.1 surround" },
  { value: "surround71", label: "7.1 surround" },
  { value: "passthrough", label: "Receiver or soundbar (pass Dolby Digital through)" },
];

const MODE_NAMES = { desktop: "Desktop", mobile: "Mobile", tv: "TV" };

/**
 * Settings that only apply to this browser, like the layout.
 */
export default function DeviceSettings() {
  const { mode, setting, host } = useController(deviceMode);
  const prefs = useController(devicePrefs);

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>This device</h1>
          <p>These settings are saved in this browser only.</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>Layout</strong>
            <span>
              {setting === "auto" ? `Picked automatically. This device is using the ${MODE_NAMES[mode]} layout.` : `Always use the ${MODE_NAMES[mode]} layout.`}
              {host === "mediahub" && " Running inside MediaHub."}
            </span>
          </div>
        </div>
        <SegmentedControl<ModeSetting>
          label="Layout"
          value={setting}
          onChange={(value) => deviceMode.setSetting(value)}
          options={[
            { value: "auto", label: "Automatic" },
            { value: "desktop", label: "Desktop" },
            { value: "mobile", label: "Mobile" },
            { value: "tv", label: "TV" },
          ]}
        />
        <p className="cn-settings__row-text"><span>The TV layout is made for the couch: everything is bigger, and you move around with the arrow keys, a remote or a game controller. Open Cinemion with <code>?mode=tv</code> at the end of the address to switch a TV straight to it.</span></p>
      </section>

      <section className="cn-settings__card">
        <h2>Playback</h2>
        <Select
          label="Speakers"
          description="Surround sound that this device can't play is converted to what it can. With a receiver or soundbar, Dolby Digital is passed on untouched for it to decode."
          value={prefs.speakers}
          onChange={(e) => devicePrefs.set({ speakers: e.target.value as Speakers })}
          options={SPEAKERS}
        />
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <p className="cn-settings__row-text">
            <strong>Intros</strong>
            <span>Cinemion finds the intros of shows by comparing their episodes, or from their chapters.</span>
          </p>
          <SegmentedControl<SkipIntros>
            label="Intros"
            value={prefs.skipIntros}
            onChange={(skipIntros) => devicePrefs.set({ skipIntros })}
            options={[{ value: "button", label: "Show Skip" }, { value: "auto", label: "Skip by itself" }, { value: "off", label: "Off" }]}
          />
        </div>
      </section>
    </>
  );
}
