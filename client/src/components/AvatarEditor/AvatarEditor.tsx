import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Slider } from "@base-ui/react/slider";
import { ImagePlus, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { UserInfo } from "@shared/api.ts";
import UsersApi from "../../Api/UsersApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import Avatar from "../Avatar/Avatar.tsx";
import "./AvatarEditor.scss";

export interface AvatarEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserInfo;
  onSaved: (user: UserInfo) => void;
}

// The crop frame, and the dimmed margin around it, in rem
const FRAME_REM = 16;
const MARGIN_REM = 2;
// Edge length of the square sent to the server, which scales it down to every stored size
const EXPORT_SIZE = 768;
const MAX_ZOOM = 4;

interface LoadedImage {
  element: HTMLImageElement;
  url: string;
  width: number;
  height: number;
}

/**
 * Pick a photo, drag and zoom it into the rounded-square frame, and upload it as the profile picture.
 */
export default function AvatarEditor(props: AvatarEditorProps) {
  const { open, onOpenChange, user, onSaved } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [zoom, setZoom] = useState(1);
  // Centre of the crop, in image pixels
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const drag = useRef<{ pointerX: number; pointerY: number; centerX: number; centerY: number } | null>(null);

  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const frame = FRAME_REM * remPx;
  const margin = MARGIN_REM * remPx;

  // Start fresh every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setImage(null);
    setZoom(1);
  }, [open]);

  // Free the object URL when the image is replaced or the editor closes
  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.url);
  }, [image]);

  const scale = image ? (frame / Math.min(image.width, image.height)) * zoom : 1;

  /**
   * Keep the crop inside the image, so the frame is always covered.
   */
  function clampCenter(x: number, y: number, s = scale) {
    if (!image) return { x, y };
    const half = frame / (2 * s);
    return {
      x: Math.min(Math.max(x, half), image.width - half),
      y: Math.min(Math.max(y, half), image.height - half),
    };
  }

  function loadFile(file: File) {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      const loaded = { element, url, width: element.naturalWidth, height: element.naturalHeight };
      setImage(loaded);
      setZoom(1);
      setCenter({ x: loaded.width / 2, y: loaded.height / 2 });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      toasts.error("This browser can't open that picture", "Try a JPG, PNG or WebP.");
    };
    element.src = url;
  }

  function changeZoom(value: number) {
    if (!image) return;
    const next = Math.min(Math.max(value, 1), MAX_ZOOM);
    setZoom(next);
    setCenter((c) => clampCenter(c.x, c.y, (frame / Math.min(image.width, image.height)) * next));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!image) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerX: e.clientX, pointerY: e.clientY, centerX: center.x, centerY: center.y };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.pointerX) / scale;
    const dy = (e.clientY - drag.current.pointerY) / scale;
    setCenter(clampCenter(drag.current.centerX - dx, drag.current.centerY - dy));
  }

  async function save() {
    if (!image) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = EXPORT_SIZE;
      canvas.height = EXPORT_SIZE;
      const side = frame / scale;
      canvas.getContext("2d")!.drawImage(image.element, center.x - side / 2, center.y - side / 2, side, side, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not prepare the picture.");
      onSaved(await UsersApi.uploadAvatar(user.id, blob));
      toasts.success("Profile picture saved");
      onOpenChange(false);
    } catch (error) {
      toasts.error("Couldn't save the picture", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removePicture() {
    setRemoving(true);
    try {
      onSaved(await UsersApi.removeAvatar(user.id));
      toasts.success("Profile picture removed");
      onOpenChange(false);
    } catch (error) {
      toasts.error("Couldn't remove the picture", (error as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  // Where the image sits inside the stage, in pixels
  const imageStyle = image && {
    width: image.width * scale,
    height: image.height * scale,
    left: margin + frame / 2 - center.x * scale,
    top: margin + frame / 2 - center.y * scale,
  };

  /**
   * The same crop, scaled down for a preview of `sizeRem`.
   */
  function previewStyle(sizeRem: number) {
    if (!image || !imageStyle) return undefined;
    const factor = (sizeRem * remPx) / frame;
    return {
      backgroundImage: `url(${image.url})`,
      backgroundSize: `${imageStyle.width * factor}px ${imageStyle.height * factor}px`,
      backgroundPosition: `${(imageStyle.left - margin) * factor}px ${(imageStyle.top - margin) * factor}px`,
    };
  }

  const footer = (
    <>
      {user.avatar && !image && <Button variant="danger" icon={<Trash2 />} onClick={removePicture} loading={removing}>Remove picture and use initials</Button>}
      <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
      {image && <Button variant="primary" onClick={save} loading={saving}>Save picture</Button>}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Profile picture" description={image ? "Drag the photo to reposition it." : "Choose a photo. You can crop it next."} size="lg" footer={footer}>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
          e.target.value = "";
        }}
      />

      {!image && (
        <div className="cn-avatar-editor__empty">
          <Avatar profile={user} size={7.5} />
          <Button variant="primary" size="lg" icon={<ImagePlus />} onClick={() => fileInput.current?.click()} data-autofocus>Choose a photo</Button>
          <span className="cn-avatar-editor__hint">JPG, PNG or WebP, up to 10 MB</span>
        </div>
      )}

      {image && imageStyle && (
        <div className="cn-avatar-editor">
          <div className="cn-avatar-editor__crop">
            <div
              className="cn-avatar-editor__stage"
              style={{ width: frame + margin * 2, height: frame + margin * 2 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onWheel={(e) => changeZoom(zoom - e.deltaY * 0.002)}
            >
              <img src={image.url} alt="" draggable={false} className="cn-avatar-editor__image" style={imageStyle} />
              <div className="cn-avatar-editor__frame" style={{ inset: margin }} />
            </div>
            <div className="cn-avatar-editor__zoom">
              <ZoomOut aria-hidden="true" />
              <Slider.Root value={zoom} min={1} max={MAX_ZOOM} step={0.01} onValueChange={(value) => changeZoom(value as number)} className="cn-avatar-editor__slider">
                <Slider.Control className="cn-slider__control">
                  <Slider.Track className="cn-slider__track">
                    <Slider.Indicator className="cn-slider__indicator" />
                    <Slider.Thumb className="cn-slider__thumb" aria-label="Zoom" />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
              <ZoomIn aria-hidden="true" />
            </div>
          </div>

          <div className="cn-avatar-editor__side">
            <span className="cn-avatar-editor__label">Preview</span>
            <div className="cn-avatar-editor__previews">
              {[{ size: 7.5, label: "Profile picker" }, { size: 3, label: "Top bar" }, { size: 1.75, label: "Badges" }].map((p) => (
                <div key={p.label} className="cn-avatar-editor__preview">
                  <span className="cn-avatar-editor__preview-image" style={{ width: `${p.size}rem`, height: `${p.size}rem`, ...previewStyle(p.size) }} />
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
            <p className="cn-avatar-editor__hint">Saved in every size Cinemion needs, from the profile picker down to the small badges in watch together.</p>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>Choose another photo</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
