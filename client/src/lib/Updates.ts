import { useEffect } from "react";
import type { UpdateInfo } from "@shared/admin.ts";
import AdminApi from "../Api/AdminApi.ts";
import { session } from "../Session.ts";
import Controller from "./Controller.ts";
import useController from "./useController.ts";

/**
 * The server checks twice a day; asking it this often is plenty for a page left open.
 */
const REFRESH_MS = 60 * 60 * 1000;

/**
 * Whether a newer Cinemion is out. Only loaded for people who manage the server; everyone else never sees it.
 */
export class UpdatesController extends Controller {
  public info: UpdateInfo | null = null;
  private _userId: number | null = null;
  private _timer: number | null = null;

  /**
   * Load the update info for this profile, or forget it when `userId` is `null` (someone who doesn't manage the server).
   */
  public follow(userId: number | null) {
    if (userId === this._userId) return;
    this._userId = userId;
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
    this.info = null;
    this.notify();
    if (userId === null) return;
    this.load();
    this._timer = setInterval(() => this.load(), REFRESH_MS);
  }

  private async load() {
    const userId = this._userId;
    const info = await AdminApi.update().catch(() => null);
    // The profile may have changed while waiting
    if (userId !== this._userId) return;
    this.set(info);
  }

  public set(info: UpdateInfo | null) {
    this.info = info;
    this.notify();
  }

  /**
   * The newer version when there is one, else `null`.
   */
  public available() {
    return this.info?.available ? this.info.latest : null;
  }
}

export const updates = new UpdatesController();

/**
 * The update info, loaded for people who manage the server.
 */
export function useUpdates() {
  const { user } = useController(session);
  useController(updates);
  const userId = user && session.can("SERVER_MANAGE") ? user.id : null;
  useEffect(() => updates.follow(userId), [userId]);
  return updates;
}

export default updates;
