/** Render step not finished — job stays RENDERING; caller may retry (poll timeout, pause, transient upstream). */
export class RenderNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderNotReadyError";
  }
}
