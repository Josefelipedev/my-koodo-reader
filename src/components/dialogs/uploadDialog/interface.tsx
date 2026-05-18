export interface UploadDialogProps {
  onClose: () => void;
  t: (key: string) => string;
}

export interface UploadDialogState {
  isDragging: boolean;
  files: File[];
  uploading: boolean;
  results: { name: string; ok: boolean; title?: string; error?: string }[];
}
