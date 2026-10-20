import type { LoginResponse, ProfileSummary, UserInfo } from "@shared/api.ts";
import BaseApi from "./BaseApi.ts";

export namespace AuthApi {
  export function login(username: string, password: string) {
    return BaseApi.POST<LoginResponse>("/auth/login", { username, password });
  }

  /**
   * Sign in from the profile picker, with the PIN or (for admins without a PIN) the password.
   */
  export function profileLogin(userId: number, secret?: { pin?: string; password?: string }) {
    return BaseApi.POST<LoginResponse>("/auth/profile", { userId, ...secret });
  }

  export function me() {
    return BaseApi.GET<UserInfo>("/auth/me");
  }

  export function getProfiles() {
    return BaseApi.GET<ProfileSummary[]>("/profiles");
  }
}

export default AuthApi;
