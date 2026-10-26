import { Download } from "lucide-react";
import { deviceMode, type Mode, type ModeSetting } from "../../lib/DeviceMode.ts";
import { devicePrefs, type SkipIntros, type Speakers } from "../../lib/DevicePrefs.ts";
import { type Theme, themes, type ThemeSetting } from "../../lib/Theme.ts";
import { install, type InstallState } from "../../lib/Install.ts";
import useController from "../../lib/useController.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Select from "../../components/Select/Select.tsx";
import Button from "../../components/Button/Button.tsx";

const SPEAKERS: { value: Speakers; label: TranslationKey }[] = [
  { value: "auto", label: "settings.device.speakerOptions.auto" },
  { value: "stereo", label: "settings.device.speakerOptions.stereo" },
  { value: "surround51", label: "settings.device.speakerOptions.surround51" },
  { value: "surround71", label: "settings.device.speakerOptions.surround71" },
  { value: "passthrough", label: "settings.device.speakerOptions.passthrough" },
];

const LAYOUT_AUTO: Record<Mode, TranslationKey> = {
  desktop: "settings.device.layoutAuto.desktop",
  mobile: "settings.device.layoutAuto.mobile",
  tv: "settings.device.layoutAuto.tv",
};

const LAYOUT_FIXED: Record<Mode, TranslationKey> = {
  desktop: "settings.device.layoutFixed.desktop",
  mobile: "settings.device.layoutFixed.mobile",
  tv: "settings.device.layoutFixed.tv",
};

const THEME_SYSTEM: Record<Theme, TranslationKey> = {
  dark: "settings.device.themeSystem.dark",
  light: "settings.device.themeSystem.light",
};

const INSTALL_TEXT: Record<InstallState, TranslationKey> = {
  installed: "settings.device.install.installed",
  prompt: "settings.device.install.prompt",
  ios: "settings.device.install.ios",
  insecure: "settings.device.install.insecure",
  browser: "settings.device.install.browser",
};

/**
 * Settings that only apply to this browser, like the layout.
 */
export default function DeviceSettings() {
  const { mode, setting, host } = useController(deviceMode);
  const prefs = useController(devicePrefs);
  const theme = useController(themes);
  const { state: installState } = useController(install);

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("settings.device.title")}</h1>
          <p>{t("settings.device.intro")}</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>{t("settings.device.layout")}</strong>
            <span>
              {setting === "auto" ? t(LAYOUT_AUTO[mode]) : t(LAYOUT_FIXED[mode])}
              {host === "mediahub" && ` ${t("settings.device.mediahub")}`}
            </span>
          </div>
        </div>
        <SegmentedControl<ModeSetting>
          label={t("settings.device.layout")}
          value={setting}
          onChange={(value) => deviceMode.setSetting(value)}
          options={[
            { value: "auto", label: t("common.automatic") },
            { value: "desktop", label: t("settings.device.layouts.desktop") },
            { value: "mobile", label: t("settings.device.layouts.mobile") },
            { value: "tv", label: t("settings.device.layouts.tv") },
          ]}
        />
        <p className="cn-settings__row-text"><span>{rich("settings.device.tvHelp", { param: <code>?mode=tv</code> })}</span></p>
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <p className="cn-settings__row-text">
            <strong>{t("settings.device.theme")}</strong>
            <span>
              {theme.setting === "system" ? t(THEME_SYSTEM[theme.theme]) : t("settings.device.themeFixed")}
            </span>
          </p>
          <SegmentedControl<ThemeSetting>
            label={t("settings.device.theme")}
            value={theme.setting}
            onChange={(value) => themes.setSetting(value)}
            options={[
              { value: "dark", label: t("settings.device.themes.dark") },
              { value: "light", label: t("settings.device.themes.light") },
              { value: "system", label: t("settings.device.themes.system") },
            ]}
          />
        </div>
      </section>

      {host !== "mediahub" && (
        <section className="cn-settings__card">
          <div className="cn-settings__row">
            <p className="cn-settings__row-text">
              <strong>{t("settings.device.install.title")}</strong>
              <span>{t(INSTALL_TEXT[installState])}</span>
            </p>
            {installState === "prompt" && (
              <Button icon={<Download />} onClick={() => install.install()}>{t("settings.device.install.button")}</Button>
            )}
          </div>
        </section>
      )}

      <section className="cn-settings__card">
        <h2>{t("settings.device.playback")}</h2>
        <Select
          label={t("settings.device.speakers")}
          description={t("settings.device.speakersDescription")}
          value={prefs.speakers}
          onChange={(e) => devicePrefs.set({ speakers: e.target.value as Speakers })}
          options={SPEAKERS.map((s) => ({ value: s.value, label: t(s.label) }))}
        />
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <p className="cn-settings__row-text">
            <strong>{t("settings.device.intros")}</strong>
            <span>{t("settings.device.introsDescription")}</span>
          </p>
          <SegmentedControl<SkipIntros>
            label={t("settings.device.intros")}
            value={prefs.skipIntros}
            onChange={(skipIntros) => devicePrefs.set({ skipIntros })}
            options={[
              { value: "button", label: t("settings.device.introOptions.button") },
              { value: "auto", label: t("settings.device.introOptions.auto") },
              { value: "off", label: t("common.off") },
            ]}
          />
        </div>
      </section>
    </>
  );
}
