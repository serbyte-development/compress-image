import * as vscode from "vscode";
import path from "node:path";
import {
  compressImage,
  formatBytes,
  getBundledToolPaths,
  getImageFormat,
  UnsupportedImageError,
} from "./compression.js";

export function activate(context: vscode.ExtensionContext): void {
  const tools = getBundledToolPaths(context.extensionPath);

  const command = vscode.commands.registerCommand(
    "compressImage.compressImage",
    async (resource?: vscode.Uri) => {
      const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri || uri.scheme !== "file") {
        void vscode.window.showWarningMessage(
          "Compress Image: select a local image file first.",
        );
        return;
      }

      if (!getImageFormat(uri.fsPath)) {
        void vscode.window.showWarningMessage(
          `Compress Image: ${path.extname(uri.fsPath) || "this file"} is not supported.`,
        );
        return;
      }

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Compressing ${path.basename(uri.fsPath)}...`,
            cancellable: false,
          },
          () => compressImage(uri.fsPath, tools),
        );

        if (result.status === "unchanged") {
          void vscode.window.showInformationMessage(
            `Compress Image: ${path.basename(uri.fsPath)} is already optimized.`,
          );
          return;
        }

        const saved = result.originalBytes - result.optimizedBytes;
        const rawPercent = (saved / result.originalBytes) * 100;
        const percent = Math.min(rawPercent, 99.9)
          .toFixed(1)
          .replace(/\.0$/, "");
        void vscode.window.showInformationMessage(
          `Compressed ${path.basename(uri.fsPath)}: ${formatBytes(result.originalBytes)} → ${formatBytes(result.optimizedBytes)} (${percent}% smaller).`,
        );
      } catch (error) {
        if (error instanceof UnsupportedImageError) {
          void vscode.window.showWarningMessage(
            `Compress Image: ${error.message}.`,
          );
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
          `Compress Image failed: ${message}`,
        );
      }
    },
  );

  context.subscriptions.push(command);
}

export function deactivate(): void {}
