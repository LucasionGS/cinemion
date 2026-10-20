import { useSyncExternalStore } from "react";
import type Controller from "./Controller.ts";

/**
 * Re-render the component whenever `controller` calls `notify()`.
 */
export function useController<T extends Controller>(controller: T): T {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller;
}

export default useController;
