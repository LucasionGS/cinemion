import Controller from "./Controller.ts";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  type: "info" | "success" | "error";
}

/**
 * Short messages in the corner of the screen. Shown by `<Toaster />`.
 */
export class ToastController extends Controller {
  public toasts: Toast[] = [];
  private _nextId = 1;

  public show(toast: Omit<Toast, "id" | "type"> & { type?: Toast["type"] }) {
    const id = this._nextId++;
    this.toasts = [...this.toasts, { type: "info", ...toast, id }];
    this.notify();
    setTimeout(() => this.dismiss(id), toast.type === "error" ? 6000 : 4000);
    return id;
  }

  public success(title: string, description?: string) {
    return this.show({ title, description, type: "success" });
  }

  public error(title: string, description?: string) {
    return this.show({ title, description, type: "error" });
  }

  public dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }
}

export const toasts = new ToastController();
