import { fileNameFromPath } from '@/lib/utils';
export { deriveProjectStatus, type ProjectStatusPatch } from '@/lib/rag-status';

export { fileNameFromPath };

/**
 * Truncates a file path to a specified maximum length, preserving the filename.
 * @param path - The full file path.
 * @param maxLength - The maximum length of the truncated path (default: 50).
 * @returns The truncated file path with the filename preserved.
 */
export function truncateFilePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path;

  const filename = fileNameFromPath(path);
  const dirPath = path.substring(0, path.length - filename.length);

  if (dirPath.length <= 10) return path; // Too short to truncate meaningfully

  const truncatedDir = dirPath.substring(0, maxLength - filename.length - 3) + '...';
  return `${truncatedDir}${filename}`;
}

/**
 * Converts a file path to a relative path based on the project root.
 * @param fullPath - The full file path.
 * @param projectRoot - The project root path.
 * @returns The relative file path, or the original path if it is not within the project root.
 */
export function getRelativeFilePath(fullPath: string, projectRoot: string): string {
  if (!fullPath.startsWith(projectRoot)) return fullPath;

  const relativePath = fullPath.substring(projectRoot.length);
  return relativePath.startsWith('/') || relativePath.startsWith('\\')
    ? relativePath.substring(1)
    : relativePath;
}
