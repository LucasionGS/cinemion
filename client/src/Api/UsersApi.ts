import { useCallback, useEffect, useState } from "react";
import type { CreateUserRequest, UpdateSelfRequest, UpdateUserRequest, UserInfo } from "@shared/api.ts";
import type { AvatarSize } from "@shared/profiles.ts";
import BaseApi from "./BaseApi.ts";

export namespace UsersApi {
  export function list() {
    return BaseApi.GET<UserInfo[]>("/users");
  }

  export function create(data: CreateUserRequest) {
    return BaseApi.POST<UserInfo>("/users", data);
  }

  export function update(id: number, data: UpdateUserRequest) {
    return BaseApi.PATCH<UserInfo>(`/users/${id}`, data);
  }

  export function updateSelf(data: UpdateSelfRequest) {
    return BaseApi.PATCH<UserInfo>("/users/me", data);
  }

  export function remove(id: number) {
    return BaseApi.DELETE<void>(`/users/${id}`);
  }

  /**
   * Upload a profile picture. The server stores it in every size it serves.
   */
  export function uploadAvatar(id: number, image: Blob) {
    const form = new FormData();
    form.append("file", image, "avatar.png");
    return BaseApi.PUTFormData<UserInfo>(`/users/${id}/avatar`, form);
  }

  export function removeAvatar(id: number) {
    return BaseApi.DELETE<UserInfo>(`/users/${id}/avatar`);
  }

  export function avatarUrl(id: number, version: string, size: AvatarSize) {
    return `/api/users/${id}/avatar/${version}/${size}`;
  }

  /**
   * Every user, for user management. `reload()` fetches them again.
   */
  export function useUsers() {
    const [users, setUsers] = useState<UserInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(() => {
      list().then(setUsers).catch((e: Error) => setError(e.message));
    }, []);

    useEffect(reload, [reload]);
    return { users, error, reload };
  }
}

export default UsersApi;
