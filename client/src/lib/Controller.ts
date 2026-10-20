/**
 * Base class for shared state. Subclasses change their fields and call `notify()`; components re-render through `useController()`.
 */
export class Controller {
  private _listeners = new Set<() => void>();
  private _version = 0;

  public subscribe = (listener: () => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  public getVersion = () => this._version;

  /**
   * Tell every subscribed component that this controller changed.
   */
  public notify() {
    this._version++;
    this._listeners.forEach((listener) => listener());
  }
}

export default Controller;
