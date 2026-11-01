"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, Scissors, Upload, X } from "lucide-react";
import { frameRect, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, outputSize, type CropRect } from "@/lib/crop";
import styles from "./StudioComponents.module.css";

type Props = { onChange: (dataUrl: string | null) => void; disabled?: boolean; petMode?: boolean };
type Source = { image: HTMLImageElement; url: string; name: string };

function cropImage(image: HTMLImageElement, rect: CropRect) {
  const canvas = document.createElement("canvas");
  const dimensions = outputSize(rect.width, rect.height);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare this image. Try a screenshot.");
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = Math.floor(payload.length * 3 / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new Error("The selected image is too detailed. Crop a smaller frame or upload a smaller screenshot.");
  return dataUrl;
}

export default function ImageCropper({ onChange, disabled = false }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<Source | null>(null);
  const revision = useRef(0);
  const callback = useRef(onChange);
  callback.current = onChange;
  const [source, setSource] = useState<Source | null>(null);
  const [mode, setMode] = useState<"single" | "sheet">("single");
  const [rows, setRows] = useState(4);
  const [columns, setColumns] = useState(4);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    revision.current += 1;
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
  }, []);

  function clearSelection() {
    setPreview(null);
    setSelectedFrame(null);
    callback.current(null);
  }

  function prepareSingle(next: Source) {
    try {
      const dataUrl = cropImage(next.image, { x: 0, y: 0, width: next.image.naturalWidth, height: next.image.naturalHeight });
      setPreview(dataUrl);
      callback.current(dataUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This image could not be prepared.");
      callback.current(null);
    }
  }

  async function upload(file: File | undefined) {
    const request = ++revision.current;
    clearSelection();
    setError("");
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    sourceRef.current = null;
    setSource(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Images must be 5 MiB or smaller. Use a smaller screenshot or crop the image first.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    setBusy(true);
    try {
      await image.decode();
      if (request !== revision.current) { URL.revokeObjectURL(url); return; }
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
        throw new Error("This image is too large to crop safely. Use an image under 8192 pixels per side and 32 megapixels.");
      }
      const next = { image, url, name: file.name };
      sourceRef.current = next;
      setSource(next);
      if (mode === "single") prepareSingle(next);
    } catch (reason) {
      URL.revokeObjectURL(url);
      if (request === revision.current) setError(reason instanceof Error && reason.message.startsWith("This image") ? reason.message : "This image could not be opened. Try a PNG, JPEG, or WebP screenshot.");
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }

  function changeMode(next: "single" | "sheet") {
    revision.current += 1;
    setBusy(false);
    setMode(next);
    setError("");
    clearSelection();
    if (next === "single" && sourceRef.current) prepareSingle(sourceRef.current);
  }

  function chooseFrame(index: number) {
    clearSelection();
    setError("");
    if (!source) return;
    try {
      const rect = frameRect(source.image.naturalWidth, source.image.naturalHeight, rows, columns, index);
      const dataUrl = cropImage(source.image, rect);
      setSelectedFrame(index);
      setPreview(dataUrl);
      callback.current(dataUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This frame could not be prepared.");
    }
  }

  function changeGrid(kind: "rows" | "columns", value: string) {
    const count = Math.max(1, Math.min(16, Math.floor(Number(value) || 1)));
    if (kind === "rows") setRows(count); else setColumns(count);
    clearSelection();
    setError("");
  }

  function removeImage() {
    revision.current += 1;
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    sourceRef.current = null;
    setSource(null);
    setBusy(false);
    setError("");
    clearSelection();
    if (inputRef.current) inputRef.current.value = "";
  }

  return <div className={styles.cropper}>
    <input ref={inputRef} id={`${id}-upload`} className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    <label className={`${styles.uploadLabel} ${disabled || busy ? styles.uploadDisabled : ""}`} htmlFor={`${id}-upload`}>
      {source ? <Upload size={18} /> : <ImagePlus size={20} />}<span>{busy ? "Opening image…" : source ? "Replace image" : "Choose image"}<small>PNG, JPEG or WebP · 5 MiB max</small></span>
    </label>
    <details className={styles.imageOptions}>
      <summary>Image options</summary>
      <fieldset className={styles.modeFieldset} disabled={disabled || busy}>
        <legend className={styles.visuallyHidden}>Image format</legend>
        <div className={styles.formatOptions}>
          <label><input type="radio" name={`${id}-format`} checked={mode === "single"} onChange={() => changeMode("single")} />Single image</label>
          <label><input type="radio" name={`${id}-format`} checked={mode === "sheet"} onChange={() => changeMode("sheet")} />Sprite sheet</label>
        </div>
      </fieldset>
      {mode === "sheet" && <p className={styles.help}>Set the grid below and choose one character frame.</p>}
    </details>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {source && <div className={styles.sourceArea}>
      <div className={styles.sourceHeading}><span title={source.name}>{source.name}</span><button type="button" onClick={removeImage} disabled={disabled} aria-label="Remove reference image"><X size={16} /></button></div>
      {mode === "sheet" && <>
        <div className={styles.gridControls}>
          <label htmlFor={`${id}-rows`}>Rows<input id={`${id}-rows`} type="number" min={1} max={16} value={rows} disabled={disabled} onChange={(event) => changeGrid("rows", event.target.value)} /></label>
          <label htmlFor={`${id}-columns`}>Columns<input id={`${id}-columns`} type="number" min={1} max={16} value={columns} disabled={disabled} onChange={(event) => changeGrid("columns", event.target.value)} /></label>
        </div>
        <div className={styles.sheet}>
          {/* The original image is displayed locally; only a chosen canvas crop leaves this component. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source.url} alt="Sprite sheet. Select a frame using the grid." />
          <div className={styles.frameGrid} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {Array.from({ length: rows * columns }, (_, index) => <button key={index} type="button" disabled={disabled} className={selectedFrame === index ? styles.selectedFrame : ""} aria-label={`Select frame ${index + 1}, row ${Math.floor(index / columns) + 1}, column ${index % columns + 1}`} aria-pressed={selectedFrame === index} onClick={() => chooseFrame(index)}><span>{index + 1}</span></button>)}
          </div>
        </div>
        <p className={styles.help}>{selectedFrame === null ? "Select one frame to continue. If frames are uneven, upload a cropped screenshot instead." : `Frame ${selectedFrame + 1} selected. Make sure it shows one complete character.`}</p>
      </>}
      {preview && <div className={styles.selectionPreview}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt={mode === "sheet" ? `Selected character frame ${Number(selectedFrame) + 1}` : "Reference image ready for interpretation"} />
        <span><Scissors size={15} />{mode === "sheet" ? "Selected frame" : "Image ready"}</span>
      </div>}
    </div>}
  </div>;
}
