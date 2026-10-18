/** Augment Window / permission mode for the File System Access API (Chrome/Edge). */

type FileSystemPermissionMode = 'read' | 'readwrite';

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: FileSystemPermissionMode;
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }): Promise<FileSystemDirectoryHandle>;
}
