export interface AppLogger {
  info(bindings: Record<string, unknown>, message?: string): void;
  warn(bindings: Record<string, unknown>, message?: string): void;
  error(bindings: Record<string, unknown>, message?: string): void;
  debug(bindings: Record<string, unknown>, message?: string): void;
  child(bindings: Record<string, unknown>): AppLogger;
}
