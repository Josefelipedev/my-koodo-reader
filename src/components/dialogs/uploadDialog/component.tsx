import React from "react";
import "./uploadDialog.css";
import { UploadDialogProps, UploadDialogState } from "./interface";
import { Trans } from "react-i18next";
import { getStoredCredentials } from "../../../pages/appGate/component";

const SUPPORTED = ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "cbr", "txt", "fb2", "docx", "md"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function fileExt(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

class UploadDialog extends React.Component<UploadDialogProps, UploadDialogState> {
  private fileInputRef = React.createRef<HTMLInputElement>();

  constructor(props: UploadDialogProps) {
    super(props);
    this.state = {
      isDragging: false,
      files: [],
      uploading: false,
      results: [],
    };
  }

  handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    this.setState({ isDragging: true });
  };

  handleDragLeave = () => {
    this.setState({ isDragging: false });
  };

  handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    this.setState({ isDragging: false });
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      SUPPORTED.includes(fileExt(f.name))
    );
    this.addFiles(dropped);
  };

  handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []).filter((f) =>
      SUPPORTED.includes(fileExt(f.name))
    );
    this.addFiles(picked);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  addFiles(incoming: File[]) {
    this.setState((s) => ({
      files: [...s.files, ...incoming.filter((f) => !s.files.find((x) => x.name === f.name))],
      results: [],
    }));
  }

  removeFile = (name: string) => {
    this.setState((s) => ({ files: s.files.filter((f) => f.name !== name), results: [] }));
  };

  uploadAll = async () => {
    const { files } = this.state;
    if (!files.length) return;

    this.setState({ uploading: true, results: [] });
    const cred = getStoredCredentials();
    const results: UploadDialogState["results"] = [];

    for (const file of files) {
      const form = new FormData();
      form.append("file", file, file.name);
      try {
        const res = await fetch("/books/upload", {
          method: "POST",
          headers: { Authorization: `Basic ${cred}` },
          body: form,
        });
        const data = await res.json();
        if (res.ok && data.success) {
          results.push({ name: file.name, ok: true, title: data.title || file.name });
        } else {
          results.push({ name: file.name, ok: false, error: data.message || res.statusText });
        }
      } catch (err: any) {
        results.push({ name: file.name, ok: false, error: err.message || "Network error" });
      }
    }

    this.setState({ uploading: false, results, files: results.filter((r) => !r.ok).map((r) => files.find((f) => f.name === r.name)!).filter(Boolean) });
  };

  render() {
    const { onClose } = this.props;
    const { isDragging, files, uploading, results } = this.state;
    const hasFiles = files.length > 0;
    const doneCount = results.filter((r) => r.ok).length;

    return (
      <div className="upload-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="upload-dialog-container setting-dialog-sidebar" style={{ background: "var(--background-color-2, #fff)" }}>
          <div className="upload-dialog-header">
            <span><Trans>Upload Books to Server</Trans></span>
            <span className="icon-close upload-dialog-close" onClick={onClose} />
          </div>

          <div className="upload-dialog-body">
            {/* Drop zone */}
            <div
              className={"upload-drop-zone" + (isDragging ? " dragging" : "")}
              onDragOver={this.handleDragOver}
              onDragLeave={this.handleDragLeave}
              onDrop={this.handleDrop}
              onClick={() => this.fileInputRef.current?.click()}
            >
              <span className="icon-upload-line upload-drop-icon" />
              <p className="upload-drop-text">
                <Trans>Drag files here or click to select</Trans>
              </p>
              <p className="upload-drop-hint">{SUPPORTED.join(", ")}</p>
            </div>
            <input
              ref={this.fileInputRef}
              type="file"
              multiple
              accept={SUPPORTED.map((e) => "." + e).join(",")}
              style={{ display: "none" }}
              onChange={this.handleFileInput}
            />

            {/* File list */}
            {hasFiles && (
              <div className="upload-file-list">
                {files.map((f) => (
                  <div className="upload-file-row" key={f.name}>
                    <span className="upload-file-name">{f.name}</span>
                    <span className="upload-file-size">{formatBytes(f.size)}</span>
                    <span
                      className="icon-close upload-file-remove"
                      onClick={() => this.removeFile(f.name)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                {doneCount > 0 && (
                  <p className="upload-result-ok">✓ {doneCount} book{doneCount !== 1 ? "s" : ""} uploaded successfully</p>
                )}
                {results.filter((r) => !r.ok).map((r) => (
                  <p key={r.name} className="upload-result-err">✗ {r.name}: {r.error}</p>
                ))}
              </div>
            )}

            <div className="upload-dialog-footer">
              <button className="upload-btn-secondary" onClick={onClose}>
                <Trans>Close</Trans>
              </button>
              <button
                className="upload-btn-primary"
                disabled={!hasFiles || uploading}
                onClick={this.uploadAll}
              >
                {uploading ? <Trans>Uploading…</Trans> : <Trans>Upload</Trans>}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default UploadDialog;
