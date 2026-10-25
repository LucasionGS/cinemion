import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { DeletePreview } from "@shared/upkeep.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes } from "../../lib/format.ts";
import { t } from "../../i18n/I18n.ts";
import Button from "../Button/Button.tsx";
import Dialog from "../Dialog/Dialog.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "./DeleteDialog.scss";

export interface DeleteDialogProps {
  /**
   * The title to delete, or `null` while closed.
   */
  item: { id: number; title: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Asks before deleting a title's files from disk, showing exactly what goes.
 */
export default function DeleteDialog(props: DeleteDialogProps) {
  const { item, onClose, onDeleted } = props;
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (item) ItemsApi.deletePreview(item.id).then(setPreview).catch((e: Error) => setError(e.message));
  }, [item?.id]);

  async function confirm() {
    if (!item) return;
    setDeleting(true);
    try {
      await ItemsApi.remove(item.id);
      toasts.success(t("deleteDialog.deleted", { title: item.title }));
      onDeleted();
    } catch (e) {
      toasts.error(t("deleteDialog.failed"), (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteDialog.title", { title: item?.title ?? "" })}
      description={t("deleteDialog.description")}
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="danger" icon={<Trash2 />} loading={deleting} disabled={!preview?.canDelete} onClick={confirm}>{t("deleteDialog.confirm")}</Button>
        </>
      )}
    >
      {!preview && !error && <Spinner size="1.5rem" />}
      {error && <p className="cn-delete__warning">{error}</p>}
      {preview && (
        <div className="cn-delete">
          <strong>{t("deleteDialog.summary", { count: preview.files, size: formatBytes(preview.size) })}</strong>
          {preview.folder && <p>{t("deleteDialog.folder", { folder: preview.folder })}</p>}
          <ul className="cn-delete__paths">
            {preview.paths.map((path) => <li key={path}>{path}</li>)}
            {preview.files > preview.paths.length && <li>{t("deleteDialog.more", { count: preview.files - preview.paths.length })}</li>}
          </ul>
          {!preview.canDelete && <p className="cn-delete__warning">{t("deleteDialog.readOnly")}</p>}
        </div>
      )}
    </Dialog>
  );
}
