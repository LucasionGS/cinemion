import { type ReactNode, useCallback, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { addToPhotoAlbum } from "../../components/AddToPhotoAlbum/AddToPhotoAlbum.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import { t } from "../../i18n/I18n.ts";

export interface SelectionBarProps {
  libraryId: number;
  selected: Set<number>;
  onDone: () => void;
  /**
   * More buttons for this page, like "Take out of this album".
   */
  children?: ReactNode;
}

/**
 * The bar along the bottom while picking photos: how many are picked and what to do with them.
 */
export default function SelectionBar(props: SelectionBarProps) {
  const { libraryId, selected, onDone, children } = props;
  const count = selected.size;
  return (
    <div className="cn-photo-selection" role="toolbar" aria-label={t("photos.selection.label")}>
      <IconButton label={t("photos.selection.stop")} icon={<X />} variant="ghost" size="sm" onClick={onDone} />
      <span className="cn-photo-selection__count">{count === 0 ? t("photos.selection.pick") : t("photos.selection.selected", { count })}</span>
      <Button size="sm" variant="primary" icon={<ImagePlus />} disabled={count === 0} onClick={() => addToPhotoAlbum.show(libraryId, [...selected])}>{t("photos.selection.addToAlbum")}</Button>
      {children}
    </div>
  );
}

/**
 * Picking photos: `selected` is `null` when not picking.
 */
export function useSelection() {
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const start = useCallback(() => setSelected(new Set()), []);
  const stop = useCallback(() => setSelected(null), []);
  const toggle = useCallback((id: number) => setSelected((current) => {
    if (!current) return current;
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  return { selected, start, stop, toggle };
}
