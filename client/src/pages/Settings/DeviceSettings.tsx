import { deviceMode, type ModeSetting } from "../../lib/DeviceMode.ts";
import useController from "../../lib/useController.ts";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";

const MODE_NAMES = { desktop: "Desktop", mobile: "Mobile", tv: "TV" };

/**
 * Settings that only apply to this browser, like the layout.
 */
export default function DeviceSettings() {
  const { mode, setting, host } = useController(deviceMode);

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
    </>
  );
}
