import * as vscode from "vscode";
import path from "node:path";
import {
  compressImage,
  formatBytes,
  getBundledToolPaths,
  getImageFormat,
  resizeImage,
  UnsupportedImageError,
} from "./compression.js";

const MAX_DISPLAY_FILENAME_LENGTH = 14;

function displayFilename(filePath: string): string {
  const filename = path.basename(filePath);
  return filename.length > MAX_DISPLAY_FILENAME_LENGTH
    ? `${filename.slice(0, MAX_DISPLAY_FILENAME_LENGTH)}…`
    : filename;
}

function selectedFile(resource?: vscode.Uri): vscode.Uri | undefined {
  return resource ?? vscode.window.activeTextEditor?.document.uri;
}

function validateResource(resource?: vscode.Uri): vscode.Uri | undefined {
  const uri = selectedFile(resource);
  if (!uri || uri.scheme !== "file") {
    void vscode.window.showWarningMessage(
      "Compress Image: select a local image file first.",
    );
    return undefined;
  }

  if (!getImageFormat(uri.fsPath)) {
    void vscode.window.showWarningMessage(
      `Compress Image: ${path.extname(uri.fsPath) || "this file"} is not supported.`,
    );
    return undefined;
  }

  return uri;
}

function showOperationError(error: unknown): void {
  if (error instanceof UnsupportedImageError) {
    void vscode.window.showWarningMessage(`Compress Image: ${error.message}.`);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`Compress Image failed: ${message}`);
}

export function activate(context: vscode.ExtensionContext): void {
  const tools = getBundledToolPaths(context.extensionPath);

  const compressCommand = vscode.commands.registerCommand(
    "compressImage.compressImage",
    async (resource?: vscode.Uri) => {
      const uri = validateResource(resource);
      if (!uri) return;

      try {
        const filename = displayFilename(uri.fsPath);
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Compressing ${filename}...`,
            cancellable: false,
          },
          () => compressImage(uri.fsPath, tools),
        );

        if (result.status === "unchanged") {
          void vscode.window.showInformationMessage(
            `Compress Image: ${filename} is already optimized.`,
          );
          return;
        }

        const saved = result.originalBytes - result.optimizedBytes;
        const rawPercent = (saved / result.originalBytes) * 100;
        const percent = Math.min(rawPercent, 99.9)
          .toFixed(1)
          .replace(/\.0$/, "");
        void vscode.window.showInformationMessage(
          `Compressed ${filename}: ${formatBytes(result.originalBytes)} → ${formatBytes(result.optimizedBytes)} (${percent}% smaller).`,
        );
      } catch (error) {
        showOperationError(error);
      }
    },
  );

  const resizeCommands = [256, 512, 1080].map((targetWidth) =>
    vscode.commands.registerCommand(
      `compressImage.resize${targetWidth}`,
      async (resource?: vscode.Uri) => {
        const uri = validateResource(resource);
        if (!uri) return;

        try {
          const filename = displayFilename(uri.fsPath);
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Resizing ${filename} to ${targetWidth} px wide...`,
              cancellable: false,
            },
            () => resizeImage(uri.fsPath, targetWidth, tools),
          );

          if (result.status === "unchanged") {
            void vscode.window.showInformationMessage(
              `Compress Image: ${filename} is ${result.originalWidth} px wide; no resize needed for ${targetWidth} px target.`,
            );
            return;
          }

          void vscode.window.showInformationMessage(
            `Resized ${filename}: ${result.originalWidth}×${result.originalHeight} → ${result.resizedWidth}×${result.resizedHeight} px, ${formatBytes(result.originalBytes)} → ${formatBytes(result.resizedBytes)}.`,
          );
        } catch (error) {
          showOperationError(error);
        }
      },
    ),
  );

  context.subscriptions.push(compressCommand, ...resizeCommands);
}

export function deactivate(): void {}
