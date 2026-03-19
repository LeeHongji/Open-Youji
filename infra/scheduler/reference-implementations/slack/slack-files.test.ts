/** Tests for Slack file upload functions and send_files action tag parsing. */

import { describe, it, expect } from "vitest";
import {
  buildFileUploadArgs,
  type FileUpload,
} from "./slack-files.js";
import { findActionTag, stripActionTags, eagerlySetPendingAction } from "./action-tags.js";

describe("buildFileUploadArgs", () => {
  it("builds args for a single file to a channel", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("png-data"), filename: "chart.png", title: "Budget Chart" },
    ];
    const result = buildFileUploadArgs(files, "C123", undefined, "Here are the charts");

    expect(result).toMatchObject({
      channel_id: "C123",
      initial_comment: "Here are the charts",
      filename: "chart.png",
      title: "Budget Chart",
    });
    expect(result!.file).toBeInstanceOf(Buffer);
  });

  it("builds args for multiple files using file_uploads", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("png1"), filename: "chart1.png", title: "Chart 1" },
      { buffer: Buffer.from("png2"), filename: "chart2.png", title: "Chart 2" },
    ];
    const result = buildFileUploadArgs(files, "C123");

    expect(result).toHaveProperty("file_uploads");
    expect(result!.channel_id).toBe("C123");
    const uploads = (result as { file_uploads: unknown[] }).file_uploads;
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toMatchObject({ filename: "chart1.png", title: "Chart 1" });
    expect(uploads[1]).toMatchObject({ filename: "chart2.png", title: "Chart 2" });
  });

  it("includes thread_ts when provided", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("png"), filename: "chart.png" },
    ];
    const result = buildFileUploadArgs(files, "C123", "1234567890.123456");

    expect(result!.thread_ts).toBe("1234567890.123456");
    expect(result!.channel_id).toBe("C123");
  });

  it("uses default filename if not provided", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("data"), title: "A File" },
    ];
    const result = buildFileUploadArgs(files, "C123");

    expect(result!.filename).toBe("file");
  });

  it("handles empty files array gracefully", () => {
    const result = buildFileUploadArgs([], "C123");
    expect(result).toBeNull();
  });

  it("sets alt_text when provided on single upload", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("png"), filename: "chart.png", altText: "Budget status bar chart" },
    ];
    const result = buildFileUploadArgs(files, "C123");

    expect(result).toMatchObject({
      alt_text: "Budget status bar chart",
      filename: "chart.png",
    });
  });

  it("sets alt_text on each file in multi-upload", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("png1"), filename: "a.png", altText: "Chart A" },
      { buffer: Buffer.from("png2"), filename: "b.png", altText: "Chart B" },
    ];
    const result = buildFileUploadArgs(files, "C123");

    const uploads = (result as { file_uploads: Array<{ alt_text?: string }> }).file_uploads;
    expect(uploads[0].alt_text).toBe("Chart A");
    expect(uploads[1].alt_text).toBe("Chart B");
  });

  it("handles non-image file types (GLB, CSV, etc.)", () => {
    const files: FileUpload[] = [
      { buffer: Buffer.from("glb-data"), filename: "model.glb", title: "3D Model" },
      { buffer: Buffer.from("csv-data"), filename: "results.csv", title: "Results" },
    ];
    const result = buildFileUploadArgs(files, "C123", undefined, "Here are the files");

    expect(result).toHaveProperty("file_uploads");
    const uploads = (result as { file_uploads: Array<{ filename: string }> }).file_uploads;
    expect(uploads[0].filename).toBe("model.glb");
    expect(uploads[1].filename).toBe("results.csv");
  });
});

describe("send_files action tag", () => {
  it("parses single path with caption", () => {
    const text = `Here are the files! [ACTION:send_files paths="outputs/model.glb" caption="3D model output"]`;
    const parsed = findActionTag(text);

    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("send_files");
    expect(parsed!.params.paths).toBe("outputs/model.glb");
    expect(parsed!.params.caption).toBe("3D model output");
  });

  it("parses multiple comma-separated paths", () => {
    const text = `[ACTION:send_files paths="outputs/a.glb,outputs/b.glb,results.csv"]`;
    const parsed = findActionTag(text);

    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("send_files");
    expect(parsed!.params.paths).toBe("outputs/a.glb,outputs/b.glb,results.csv");
    expect(parsed!.params.caption).toBe("");
  });

  it("is stripped by stripActionTags", () => {
    const text = `Sending files now!\n[ACTION:send_files paths="model.glb" caption="test"]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("Sending files now!");
  });

  it("is not a confirmable action (eagerlySetPendingAction returns null)", () => {
    const parsed = findActionTag(`[ACTION:send_files paths="x.glb"]`);
    expect(parsed).not.toBeNull();
    const pending = eagerlySetPendingAction(parsed!);
    expect(pending).toBeNull();
  });
});

describe("send_images backward compatibility", () => {
  it("parses send_images as send_files kind", () => {
    const text = `[ACTION:send_images paths="reports/charts/budget.png" caption="Budget status"]`;
    const parsed = findActionTag(text);

    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("send_files");
    expect(parsed!.params.paths).toBe("reports/charts/budget.png");
    expect(parsed!.params.caption).toBe("Budget status");
  });

  it("strips send_images tags", () => {
    const text = `Sending charts now!\n[ACTION:send_images paths="chart.png" caption="test"]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("Sending charts now!");
  });

  it("send_images is not a confirmable action", () => {
    const parsed = findActionTag(`[ACTION:send_images paths="x.png"]`);
    expect(parsed).not.toBeNull();
    const pending = eagerlySetPendingAction(parsed!);
    expect(pending).toBeNull();
  });
});
