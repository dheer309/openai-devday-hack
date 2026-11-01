"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, Box, Check, ChevronDown, CircleAlert,
  LoaderCircle, RotateCcw,
} from "lucide-react";
import ModelViewer from "@/components/ModelViewer";
import ImageCropper from "@/components/ImageCropper";
import { designSchema, renderResultSchema, requiredChecks, sameDesign, type DesignSpec, type DesignV2, type RenderResult } from "@/lib/contracts";

type InputType = "text" | "photo";
type Busy = "ai" | "render" | null;
type Source = "ai" | "manual";
type Failure = { message: string; details: string[] };
type RenderRecord = { data: RenderResult; epoch: number };

const checkLabels: Record<string, string> = {
  closed_mesh: "Closed 3D shape", seam_lengths: "Matching seam lengths",
  seam_labels: "Numbered matching edges", one_tab_per_seam: "One tab per join",
  no_overlaps: "No overlapping panels or tabs", page_bounds: "Fits A4 safe margins",
  label_legibility: "Readable assembly labels", refold_geometry: "Digital fold check",
  usable_tabs: "Usable glue tabs", minimum_edge_size: "Comfortable edge sizes", tab_receiver_fit: "Tabs fit receiving faces", assembly_complexity: "Manageable assembly",
};

async function readResponse(response: Response) {
  let body;
  try { body = await response.json(); }
  catch { throw { message: "The service returned an unreadable response. Please try again.", details: [] }; }
  if (!response.ok) {
    throw {
      message: typeof body?.error?.message === "string" ? body.error.message : "The request could not be completed. Please try again.",
      details: Array.isArray(body?.error?.details) ? body.error.details.filter((item: unknown) => typeof item === "string") : [],
    };
  }
  return body;
}

function asFailure(error: unknown): Failure {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return { message: error.message, details: "details" in error && Array.isArray(error.details) ? error.details : [] };
  }
  return { message: "Something interrupted the request. Please try again.", details: [] };
}

export default function Home() {
  const [inputType, setInputType] = useState<InputType>("photo");
  const [text, setText] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualShape, setManualShape] = useState<DesignV2["shape"]>("rounded");
  const [image, setImage] = useState<string | null>(null);
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [source, setSource] = useState<Source>("ai");
  const [rendered, setRendered] = useState<RenderRecord | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [modelFailure, setModelFailure] = useState<string | null>(null);
  const [netFailure, setNetFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<"model" | "net">("model");
  const [modelLoaded, setModelLoaded] = useState(false);
  const [netLoaded, setNetLoaded] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const requestEpoch = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const invalidate = useCallback(() => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setRendered(null);
    setModelLoaded(false);
    setNetLoaded(false);
    setModelFailure(null);
    setNetFailure(null);
    setFailure(null);
    setBusy(null);
  }, []);

  const beginRequest = useCallback((stage: Busy) => {
    invalidate();
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(stage);
    return { epoch: requestEpoch.current, signal: controller.signal };
  }, [invalidate]);

  const requestRender = useCallback(async (spec: DesignSpec, epoch: number, signal: AbortSignal) => {
    if (signal.aborted || requestEpoch.current !== epoch) return;
    setBusy("render");
    const body = await readResponse(await fetch("/api/render", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec), signal,
    }));
    const parsed = renderResultSchema.safeParse(body);
    if (!parsed.success) throw { message: "The geometry service returned a result that does not match the print contract. Download is blocked.", details: [] };
    const result = parsed.data;
    if (!sameDesign(result.design, spec)) {
      throw { message: "The returned model does not match your current design. Please rebuild the preview.", details: [] };
    }
    if (result.validation.status !== "passed" || !requiredChecks(result.design).every(check => result.validation.checks.includes(check))) {
      throw { message: "This net has not passed every print check. Download is blocked.", details: requiredChecks(result.design).filter(check => !result.validation.checks.includes(check)) };
    }
    if (!signal.aborted && requestEpoch.current === epoch) setRendered({ data: result, epoch });
  }, []);

  useEffect(() => {
    const configController = new AbortController();
    fetch("/api/config", { signal: configController.signal, cache: "no-store" })
      .then(readResponse).then(config => setAiConfigured(config.ai_configured === true))
      .catch(() => { if (!configController.signal.aborted) setAiConfigured(null); });
    return () => { requestController.current?.abort(); configController.abort(); requestEpoch.current += 1; };
  }, []);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    const { epoch, signal } = beginRequest("ai");
    try {
      const body = await readResponse(await fetch("/api/design", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_type: inputType, text, image_data_url: inputType === "text" ? null : image }), signal,
      }));
      const parsed = designSchema.safeParse(body.design);
      if (!parsed.success || body.source !== "ai") throw { message: "AI did not return a supported design. Please retry or use the manual controls.", details: [] };
      if (signal.aborted || requestEpoch.current !== epoch) return;
      setDesign(parsed.data);
      setSource("ai");
      await requestRender(parsed.data, epoch, signal);
    } catch (error) {
      if (!signal.aborted && requestEpoch.current === epoch) setFailure(asFailure(error));
    } finally {
      if (requestEpoch.current === epoch) setBusy(null);
    }
  };

  const buildPreview = async () => {
    if (!design) return;
    const { epoch, signal } = beginRequest("render");
    const parsed = designSchema.safeParse(design);
    if (!parsed.success) {
      setFailure({ message: "Check the name, shape, size, and proportions before building the preview.", details: [] });
      setBusy(null);
      return;
    }
    setDesign(parsed.data);
    try { await requestRender(parsed.data, epoch, signal); }
    catch (error) { if (!signal.aborted && requestEpoch.current === epoch) setFailure(asFailure(error)); }
    finally { if (requestEpoch.current === epoch) setBusy(null); }
  };

  const createManual = async () => {
    const profiles = { box: { width: 1, height: 1, depth: 1 }, rounded: { width: 1.1, height: 1, depth: 0.9 }, diamond: { width: 1, height: 1, depth: 1 }, crystal: { width: 0.9, height: 1.3, depth: 0.9 } };
    const parsed = designSchema.safeParse({ version: 2, name: manualName, shape: manualShape, proportions: profiles[manualShape], ears: "none", size_mm: manualShape === "box" || manualShape === "rounded" ? 50 : 55, face: { eyes: "round", mouth: "smile", whiskers: false, markings: "none" } });
    if (!parsed.success) { setFailure({ message: "Enter a printable Latin-script name of 1–48 characters.", details: [] }); return; }
    const { epoch, signal } = beginRequest("render");
    setDesign(parsed.data);
    setSource("manual");
    try { await requestRender(parsed.data, epoch, signal); }
    catch (error) { if (!signal.aborted && requestEpoch.current === epoch) setFailure(asFailure(error)); }
    finally { if (requestEpoch.current === epoch) setBusy(null); }
  };

  const updateDesign = (next: DesignSpec) => { invalidate(); setDesign(next); setSource("manual"); };
  const updateFace = (key: keyof DesignSpec["face"], value: string | boolean) => {
    if (design) updateDesign({ ...design, face: { ...design.face, [key]: value } });
  };
  const receiveImage = useCallback((dataUrl: string | null) => { invalidate(); setImage(dataUrl); }, [invalidate]);
  const modelReady = useCallback(() => {
    if (rendered && requestEpoch.current === rendered.epoch) {
      setModelLoaded(true);
      setModelFailure(null);
    }
  }, [rendered]);
  const modelError = useCallback((message: string) => {
    if (rendered && requestEpoch.current === rendered.epoch) { setModelLoaded(false); setModelFailure(message); }
  }, [rendered]);
  const result = rendered?.data;
  const validationPassed = !!rendered && rendered.epoch === requestEpoch.current && !!result && result.validation.status === "passed" && requiredChecks(result.design).every(check => result.validation.checks.includes(check));
  const canDownload = validationPassed && modelLoaded && netLoaded && !busy && !failure && !modelFailure && !netFailure;
  const canInterpret = !busy && aiConfigured !== false && (inputType === "text" ? text.trim().length > 0 : !!image);
  const progressLabel = busy === "ai" ? "Interpreting your reference…" : busy === "render" ? "Building assets and checking the net…" : null;

  // The GLB viewer presents its own retryable model error.
  const visibleError = failure?.message || netFailure;
  const sourceLabel = source === "manual" ? "Edited design" : "AI interpretation";
  const hasPreview = !!design || !!busy;
  const printChecks = design ? requiredChecks(design) : [];

  return (
    <div className="studio">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Foldable AI home"><Box size={23} strokeWidth={1.5} />foldable <span>AI</span></a>
      </header>
      <main>
        <h1>Turn a pet or idea into paper.</h1>
        <div className={hasPreview ? "workspace" : "workspace input-only"}>
          <aside className="editor-panel" aria-label="Design your companion">
            <form onSubmit={generate}>
              <div className="input-tabs" aria-label="Reference type">
                {([{ id: "photo", label: "Image" }, { id: "text", label: "Text" }] as const).map(item => (
                  <button key={item.id} type="button" className={inputType === item.id ? "active" : ""} aria-pressed={inputType === item.id} onClick={() => {
                    if (inputType !== item.id) { invalidate(); setInputType(item.id); setImage(null); }
                  }}>{item.label}</button>
                ))}
              </div>
              {inputType === "photo" && <ImageCropper onChange={receiveImage} disabled={!!busy} />}
              {inputType === "text" ? <div className="description-field">
                <label className="field-label" htmlFor="description">Describe your character</label>
                <textarea id="description" value={text} maxLength={2000} rows={5} placeholder="A sleepy robot with freckles…" onChange={event => { invalidate(); setText(event.target.value); }} />
              </div> : <details className="note-details"><summary>Add a note <ChevronDown size={14} /></summary><label className="sr-only" htmlFor="description">Optional guidance</label><textarea id="description" value={text} maxLength={2000} rows={2} placeholder="Keep the sleepy eyes…" onChange={event => { invalidate(); setText(event.target.value); }} /></details>}
              <button className="primary-button" type="submit" disabled={!canInterpret}>{busy === "ai" ? <LoaderCircle className="spin" size={16} /> : null}{busy === "ai" ? "Interpreting…" : "Make paper pet"}</button>
              {aiConfigured === false && <p className="setup-note">Set OPENAI_API_KEY and OPENAI_MODEL in the server environment, then restart the application.</p>}
              {!hasPreview && visibleError && <p className="setup-note" role="alert">{visibleError}</p>}
            </form>
            {!design && <details className="features-details">
              <summary>Design manually <ChevronDown size={14} /></summary>
              <div className="features-content">
                <label className="field-label" htmlFor="manual-name">Name your character</label>
                <input id="manual-name" value={manualName} maxLength={48} onChange={event => { setManualName(event.target.value); setFailure(null); }} />
                <div className="feature-grid"><FeatureSelect label="Starting shape" value={manualShape} options={[["box", "Box"], ["rounded", "Rounded"], ["diamond", "Diamond"], ["crystal", "Crystal"]]} onChange={value => setManualShape(value as DesignV2["shape"])} /></div>
                <button type="button" className="secondary-button" onClick={() => void createManual()} disabled={!!busy || !manualName.trim()}>Create printable model</button>
              </div>
            </details>}
            {design && <details className="features-details">
              <summary>Adjust features <ChevronDown size={14} /></summary>
              <div className="features-content">
                <label className="field-label" htmlFor="companion-name">Name</label>
                <input id="companion-name" value={design.name} maxLength={48} onChange={event => updateDesign({ ...design, name: event.target.value })} />
                {design.version === 2 && <>
                  <div className="feature-grid">
                    <FeatureSelect label="Shape" value={design.shape} options={[["box", "Box"], ["rounded", "Rounded"], ["diamond", "Diamond"], ["crystal", "Crystal"]]} onChange={value => {
                      const shape = value as DesignV2["shape"];
                      const profiles = { box: { width: 1, height: 1, depth: 1 }, rounded: { width: 1.1, height: 1, depth: 0.9 }, diamond: { width: 1, height: 1, depth: 1 }, crystal: { width: 0.9, height: 1.3, depth: 0.9 } };
                      updateDesign({ ...design, shape, proportions: profiles[shape], ears: "none", size_mm: shape === "rounded" || shape === "box" ? 50 : 55 });
                    }} />
                    <FeatureSelect label="Ears" value={design.ears} options={[["none", "None"], ["pointed", "Pointed"]]} onChange={value => updateDesign({ ...design, ears: value as DesignV2["ears"] })} />
                    <NumberField label="Size (mm)" value={design.size_mm} min={40} max={65} step={1} onChange={value => updateDesign({ ...design, size_mm: value })} />
                    {(["width", "height", "depth"] as const).map(axis => <NumberField key={axis} label={axis[0].toUpperCase() + axis.slice(1)} value={design.proportions[axis]} min={0.75} max={1.3} step={0.05} onChange={value => updateDesign({ ...design, proportions: { ...design.proportions, [axis]: value } })} />)}
                  </div>
                </>}
                <div className="feature-grid">
                  <FeatureSelect label="Eyes" value={design.face.eyes} options={[["round", "Round"], ["sleepy", "Sleepy"], ["happy", "Happy"]]} onChange={value => updateFace("eyes", value)} />
                  <FeatureSelect label="Mouth" value={design.face.mouth} options={[["smile", "Smile"], ["neutral", "Neutral"], ["open", "Open"]]} onChange={value => updateFace("mouth", value)} />
                  <FeatureSelect label="Markings" value={design.face.markings} options={[["none", "None"], ["freckles", "Freckles"], ["forehead_patch", "Forehead patch"]]} onChange={value => updateFace("markings", value)} />
                  <label className="checkbox-label"><input id="whiskers" type="checkbox" checked={design.face.whiskers} onChange={event => updateFace("whiskers", event.target.checked)} />Whiskers</label>
                </div>
                <button type="button" className="secondary-button" onClick={() => void buildPreview()} disabled={!!busy}><RotateCcw size={14} />Update preview</button>
              </div>
            </details>}
            <p className="interpretation-note">A stylised low-poly interpretation, unfolded onto one A4 sheet.</p>
          </aside>

          {hasPreview && <section className="preview-panel" aria-label="Companion preview">
            <div className="preview-toolbar">
              <div className="preview-name"><h2>{design?.name.trim() || "Creating your paper pet"}</h2><span>{sourceLabel}</span></div>
              <div className="preview-tabs" role="tablist" aria-label="Preview type">
                <button id="model-tab" type="button" role="tab" aria-selected={tab === "model"} aria-controls="model-panel" className={tab === "model" ? "active" : ""} onClick={() => setTab("model")}>3D</button>
                <button id="net-tab" type="button" role="tab" aria-selected={tab === "net"} aria-controls="net-panel" className={tab === "net" ? "active" : ""} onClick={() => setTab("net")}>Paper net</button>
              </div>
            </div>
            <div className="preview-stage" aria-busy={!!busy}>
              {rendered && result ? <>
                <div className="model-pane" id="model-panel" role="tabpanel" aria-labelledby="model-tab" hidden={tab !== "model"}>
                  <ModelViewer key={`${rendered.epoch}:${result.model_url}`} modelUrl={result.model_url} onReady={modelReady} onError={modelError} />
                </div>
                <div className="net-pane" id="net-panel" role="tabpanel" aria-labelledby="net-tab" hidden={tab !== "net"}>
                  <img key={`${rendered.epoch}:${result.preview_url}`} src={result.preview_url} alt={`A4 paper net for ${result.design.name}`} onLoad={() => { if (requestEpoch.current === rendered.epoch) { setNetLoaded(true); setNetFailure(null); } }} onError={() => { if (requestEpoch.current === rendered.epoch) { setNetLoaded(false); setNetFailure("The paper net could not load. Retry the preview."); } }} />
                </div>
              </> : <div className="preview-progress">{busy ? <LoaderCircle className="spin" size={25} strokeWidth={1.5} /> : <Box size={36} strokeWidth={1} />}<p role={busy ? "status" : undefined}>{busy ? progressLabel : "Update the preview to see your changes."}</p></div>}
            </div>
            <div className="print-panel">
              {visibleError && <div className="error-notice" role="alert"><CircleAlert size={16} /><div><p>{visibleError}</p>{failure && failure.details.length > 0 && <ul>{failure.details.map((detail, index) => <li key={`${detail}-${index}`}>{checkLabels[detail] || detail}</li>)}</ul>}<button type="button" className="text-button" disabled={!!busy} onClick={() => void buildPreview()}>Retry preview</button></div></div>}
              {result && validationPassed && (!modelLoaded || !netLoaded) && !visibleError && !modelFailure && <p className="progress-note" role="status"><LoaderCircle className="spin" size={14} />Loading model and net…</p>}
              <div className="download-row">
                <details className="validation-details"><summary><span className={validationPassed ? "status-dot passed" : "status-dot"} />{validationPassed ? "Print checks passed" : "Print checks pending"}<ChevronDown size={13} /></summary><div><ul>{printChecks.map(check => <li key={check}>{validationPassed ? <Check size={12} /> : <span className="check-placeholder" />}{checkLabels[check]}</li>)}</ul><p>Software validation only. Physical assembly has not been checked.</p></div></details>
                {canDownload && result ? <a className="download-button" href={result.pdf_url} download={`${result.design.name}.pdf`}><ArrowDownToLine size={16} />Download PDF</a> : <button className="download-button" type="button" disabled><ArrowDownToLine size={16} />Download PDF</button>}
              </div>
              <p className="print-note">{"size_mm" in (result?.stats || {}) ? `${(result!.stats as { size_mm: number }).size_mm} mm · ` : ""}A4 · Single-sided · Print at 100% / actual size.</p>
            </div>
          </section>}
        </div>
      </main>
    </div>
  );
}

function FeatureSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const id = `feature-${label.toLowerCase()}`;
  return <div><label className="field-label" htmlFor={id}>{label}</label><div className="select-wrap"><select id={id} value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></div></div>;
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="number-field"><span className="field-label">{label}</span><input type="number" min={min} max={max} step={step} value={Number.isNaN(value) ? "" : value} onChange={event => onChange(event.target.value === "" ? NaN : Number(event.target.value))} /></label>;
}
