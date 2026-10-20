import type { LoginResponse, ServerInfo, UserInfo } from "@shared/api.ts";
import type { Permission } from "@shared/profiles.ts";
import Controller from "./lib/Controller.ts";
import BaseApi from "./Api/BaseApi.ts";
import AuthApi from "./Api/AuthApi.ts";
import ServerApi from "./Api/ServerApi.ts";
import { router } from "./lib/Router.tsx";

/**
 * Who is signed in, and what the server told us about itself.
 */
export class SessionController extends Controller {
  public server: ServerInfo | null = null;
  public user: UserInfo | null = null;
  /**
   * `true` once the server info and the current user have been loaded.
   */
  public ready = false;
  public error: string | null = null;

  constructor() {
    super();
    BaseApi.setOnUnauthorized(() => {
      this.clear();
      router.navigate("/profiles", { replace: true });
    });
  }

  /**
   * Load the server info and, when a token is stored, the signed-in user. Called once at startup.
   */
  public async init() {
    try {
      this.server = await ServerApi.getInfo();
      if (BaseApi.getToken() && !this.server.needsSetup) {
        this.user = await AuthApi.me().catch(() => null);
        if (!this.user) BaseApi.setToken(null);
      }
      this.error = null;
    } catch (error) {
      this.error = (error as Error).message;
    }
    this.ready = true;
    this.notify();
  }

  public signIn(response: LoginResponse) {
    BaseApi.setToken(response.token);
    this.user = response.user;
    if (this.server) this.server.needsSetup = false;
    this.notify();
  }

  public setUser(user: UserInfo) {
    this.user = user;
    this.notify();
  }

  /**
   * Forget the signed-in user on this device.
   */
  public clear() {
    BaseApi.setToken(null);
    this.user = null;
    this.notify();
  }

  public signOut() {
    this.clear();
    router.navigate("/profiles");
  }

  public isAdmin() {
    return this.user?.role === "admin";
  }

  public can(permission: Permission) {
    return this.isAdmin() || (this.user?.permissions.includes(permission) ?? false);
  }
}

export const session = new SessionController();
