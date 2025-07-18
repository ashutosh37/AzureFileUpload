export interface RedactionCoordinate {
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
}

export interface SasUploadInfo {
  // blobUri: string; // Not used directly
  sharedAccessSignature: string;
  fullUploadUrl: string;
}

// This interface represents the data structure coming from the backend
export interface BackendFileInfo {
  name: string;
  checksum: string;
  documentId?: string;
  metadata?: Record<string, string>;
  parentId?: string; // New property to link child items to their parent

  isFolder?: boolean; // New property from backend
}

// This interface represents items displayed in the grid (can be a folder or a file)
export interface DisplayItem {
  id: string; // Unique key for React, typically the full path
  displayName: string; // Name to show in the grid, e.g., "MyFolder" or "MyFile.txt"
  fullPath: string; // Full path from container root. For folders, it's the prefix.
  isFolder: boolean;
  checksum: string; // Checksum for files, "N/A" or empty for folders
  documentId?: string;
  metadata?: Record<string, string>;
  parentId?: string; // Added for hierarchical display
}

// New state to manage files with their current processing status
export interface FileToProcess {
  file: File;
  overwrite: boolean; // Flag to indicate if this file should overwrite existing
  status:
    | "pending"
    | "uploading"
    | "success"
    | "error"
    | "conflict"
    | "skipped";
  errorMessage?: string;
}

// Add props interface for initial values from URL
export interface FileUploadFormProps {
  initialContainerName?: string;
  initialFolderPath?: string;
}

export interface FileToProcess {
  file: File;
  overwrite: boolean;
  status:
    | "pending"
    | "uploading"
    | "success"
    | "error"
    | "skipped"
    | "conflict";
  errorMessage?: string;
}
