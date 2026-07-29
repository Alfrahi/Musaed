import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extracts filename from a full file path.
 * Shared by conversation and RAG features to avoid duplication.
 */
export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}
