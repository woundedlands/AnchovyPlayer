// Path handling that works for both `C:\music\kit` and `/home/me/music/kit`.

const separatorPattern = /[\\/]+/;

export function separatorOf(path: string): string {
  return path.includes("\\") || /^[a-zA-Z]:/.test(path) ? "\\" : "/";
}

/** `C:\a\b` -> ["C:\", "a", "b"]; `/a/b` -> ["/", "a", "b"]. The first item is the root. */
export function splitPath(path: string): string[] {
  const separator = separatorOf(path);
  const parts = path.split(separatorPattern).filter((part) => part.length > 0);
  if (separator === "/") {
    return ["/", ...parts];
  }
  if (parts.length === 0) {
    return [];
  }

  return [parts[0] + "\\", ...parts.slice(1)];
}

export function joinSegments(segments: string[]): string {
  if (segments.length === 0) {
    return "";
  }
  const [root, ...rest] = segments;
  const separator = root === "/" ? "/" : "\\";

  return root + rest.join(separator);
}

/** Parent folder, or null at a root. */
export function parentOf(path: string): string | null {
  const segments = splitPath(path);
  if (segments.length <= 1) {
    return null;
  }

  return joinSegments(segments.slice(0, -1));
}

export function nameOf(path: string): string {
  const segments = splitPath(path);

  return segments[segments.length - 1] ?? path;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function normalizePath(path: string): string {
  return joinSegments(splitPath(path.trim()));
}

export function samePath(a: string, b: string): boolean {
  // Windows paths are case-insensitive; comparing them case-sensitively would lose focus after a rename of case only.
  const caseInsensitive = separatorOf(a) === "\\";
  const left = normalizePath(a);
  const right = normalizePath(b);

  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}
