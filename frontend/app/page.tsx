"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, Box, Check, ChevronDown, CircleAlert,
  FileImage, FileText, Heart, Layers, LoaderCircle, PencilLine,
  RotateCcw, Scissors, ShieldCheck, Sparkles, WandSparkles,
} from "lucide-react";
import ModelViewer from "@/components/ModelViewer";
import ImageCropper from "@/components/ImageCropper";
import { designSchema, renderResultSchema, REQUIRED_CHECKS, type DesignSpec, type RenderResult } from "@/lib/contracts";

type InputType = "text" | "photo" | "chatgpt_pet";
type Busy = "example" | "ai" | "render" | null;
type Source = "example" | "ai" | "manual";
type Failure = { message: string; details: string[] };
type RenderRecord = { data: RenderResult; epoch: number };

const checkLabels: Record<string, string> = {
  closed_mesh: "Closed 3D shape", seam_lengths: "Matching seam lengths",
  seam_labels: "Numbered matching edges", one_tab_per_seam: "One tab per join",
  no_overlaps: "No overlapping panels or tabs", page_bounds: "Fits A4 safe margins",
  label_legibility: "Readable assembly labels", refold_geometry: "Digital fold check",
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
  const [inputType, setInputType] = useState<InputType>("text");
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [source, setSource] = useState<Source>("example");
  const [rendered, setRendered] = useState<RenderRecord | null>(null);
  const [busy, setBusy] = useState<Busy>("example");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [assetFailure, setAssetFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<"model" | "net">("model");
  const [modelLoaded, setModelLoaded] = useState(false);
  const [netLoaded, setNetLoaded] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const requestEpoch = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const invalidate = useCallback(() => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setRendered(null);
    setModelLoaded(false);
    setNetLoaded(false);
    setAssetFailure(null);
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
    if (JSON.stringify(designSchema.parse(result.design)) !== JSON.stringify(designSchema.parse(spec))) {
      throw { message: "The returned model does not match your current design. Please rebuild the preview.", details: [] };
    }
    if (result.validation.status !== "passed" || !REQUIRED_CHECKS.every(check => result.validation.checks.includes(check))) {
      throw { message: "This net has not passed every print check. Download is blocked.", details: REQUIRED_CHECKS.filter(check => !result.validation.checks.includes(check)) };
    }
    if (!signal.aborted && requestEpoch.current === epoch) setRendered({ data: result, epoch });
  }, []);

  const loadExample = useCallback(async () => {
    const { epoch, signal } = beginRequest("example");
    try {
      const body = await readResponse(await fetch("/api/example", { signal, cache: "no-store" }));
      const parsed = designSchema.safeParse(body.design);
      if (!parsed.success || body.source !== "example") throw { message: "The saved example could not be read. You can still create a design with the controls.", details: [] };
      if (signal.aborted || requestEpoch.current !== epoch) return;
      setDesign(parsed.data);
      setSource("example");
      await requestRender(parsed.data, epoch, signal);
    } catch (error) {
      if (!signal.aborted && requestEpoch.current === epoch) setFailure(asFailure(error));
    } finally {
      if (requestEpoch.current === epoch) setBusy(null);
    }
  }, [beginRequest, requestRender]);

  useEffect(() => {
    void loadExample();
    const configController = new AbortController();
    fetch("/api/config", { signal: configController.signal, cache: "no-store" })
      .then(readResponse).then(config => setAiConfigured(config.ai_configured === true))
      .catch(() => { if (!configController.signal.aborted) setAiConfigured(null); });
    return () => { requestController.current?.abort(); configController.abort(); requestEpoch.current += 1; };
  }, [loadExample]);

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
    if (!design) return void loadExample();
    const { epoch, signal } = beginRequest("render");
    const parsed = designSchema.safeParse(design);
    if (!parsed.success) {
      setFailure({ message: "Give your companion a name of 1–48 characters before building the preview.", details: [] });
      setBusy(null);
      return;
    }
    setDesign(parsed.data);
    try { await requestRender(parsed.data, epoch, signal); }
    catch (error) { if (!signal.aborted && requestEpoch.current === epoch) setFailure(asFailure(error)); }
    finally { if (requestEpoch.current === epoch) setBusy(null); }
  };

  const updateDesign = (next: DesignSpec) => { invalidate(); setDesign(next); setSource("manual"); };
  const updateFace = (key: keyof DesignSpec["face"], value: string | boolean) => {
    if (design) updateDesign({ ...design, face: { ...design.face, [key]: value } });
  };
  const receiveImage = useCallback((dataUrl: string | null) => { invalidate(); setImage(dataUrl); }, [invalidate]);
  const modelReady = useCallback(() => { if (rendered && requestEpoch.current === rendered.epoch) setModelLoaded(true); }, [rendered]);
  const modelError = useCallback((message: string) => {
    if (rendered && requestEpoch.current === rendered.epoch) { setModelLoaded(false); setAssetFailure(message); }
  }, [rendered]);
  const result = rendered?.data;
  const validationPassed = !!result && result.validation.status === "passed" && REQUIRED_CHECKS.every(check => result.validation.checks.includes(check));
  const canDownload = validationPassed && modelLoaded && netLoaded && !busy && !failure && !assetFailure;
  const canInterpret = !busy && aiConfigured !== false && (inputType === "text" ? text.trim().length > 0 : !!image);
  const progressLabel = busy === "example" ? "Loading the saved design…" : busy === "ai" ? "Interpreting your reference…" : busy === "render" ? "Building assets and checking the net…" : null;

  return (
    <div className="studio">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Foldable AI home"><span className="brand-icon"><Box size={23} strokeWidth={1.65} /></span>foldable<span className="brand-ai">AI</span></a>
        <span className="header-note"><span className="live-dot" /> From pixels to paper</span>
        <a className="how-link" href="#assembly">How it works <ArrowRight size={14} /></a>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div><p className="eyebrow">A LITTLE IMAGINATION. A SINGLE SHEET.</p><h1 id="page-title">Meet your next<br /><span>paper companion.</span></h1></div>
          <div className="intro-description"><p>Bring your ChatGPT pet into the real world.<br className="desktop-break" /> Describe a character or start with a picture.<br className="desktop-break" /> Make it yours. Then cut, fold, and keep.</p><span><Scissors size={15} /> Black ink. White paper. A little personality.</span></div>
        </section>

        <div className="workspace">
          <aside className="editor-panel" aria-label="Design your companion">
            <section className="input-section">
              <div className="section-heading"><span className="step-number">01</span><h2>Start with a spark</h2></div>
              <form onSubmit={generate}>
                <div className="input-tabs" aria-label="Reference type">
                  {([{ id: "text", label: "Describe", icon: PencilLine }, { id: "photo", label: "Photo", icon: FileImage }, { id: "chatgpt_pet", label: "ChatGPT pet", icon: Heart }] as const).map(item => (
                    <button key={item.id} type="button" className={inputType === item.id ? "input-tab active" : "input-tab"} aria-pressed={inputType === item.id} onClick={() => { if (inputType !== item.id) { invalidate(); setInputType(item.id); setImage(null); } }}><item.icon size={14} />{item.label}</button>
                  ))}
                </div>
                {inputType !== "text" && <ImageCropper key={inputType} onChange={receiveImage} disabled={!!busy} petMode={inputType === "chatgpt_pet"} />}
                <label className="field-label" htmlFor="description">{inputType === "text" ? "What’s your character like?" : "Add a little direction (optional)"}</label>
                <div className="textarea-wrap"><textarea id="description" value={text} maxLength={2000} rows={inputType === "text" ? 4 : 2} placeholder={inputType === "text" ? "A sleepy little robot with a cheeky smile and freckles…" : "Keep the happy eyes and little whiskers…"} onChange={event => { invalidate(); setText(event.target.value); }} /><span className="character-count">{text.length}/2000</span></div>
                <button className="primary-button interpret-button" type="submit" disabled={!canInterpret}>{busy === "ai" ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />} {busy === "ai" ? "Finding their personality…" : "Imagine my companion"}<ArrowRight className="button-end" size={16} /></button>
                {aiConfigured === false && <p className="setup-note"><CircleAlert size={13} /><span>AI isn’t configured yet. Use the saved example and edit its features below.</span></p>}
                <div className="example-row"><span>Just looking around?</span><button type="button" onClick={() => void loadExample()} disabled={!!busy}>Try the saved robot <ArrowRight size={12} /></button></div>
              </form>
            </section>

            <section className="features-section" aria-labelledby="features-title">
              <div className="section-heading"><span className="step-number">02</span><h2 id="features-title">Make it yours</h2><span className="small-note">Always editable</span></div>
              {design ? <>
                <label className="field-label" htmlFor="companion-name">Companion’s name</label>
                <input className="name-input" id="companion-name" value={design.name} maxLength={48} onChange={event => updateDesign({ ...design, name: event.target.value })} />
                <div className="feature-grid">
                  <FeatureSelect label="Eyes" value={design.face.eyes} options={[["round", "Round"], ["sleepy", "Sleepy"], ["happy", "Happy"]]} onChange={value => updateFace("eyes", value)} />
                  <FeatureSelect label="Mouth" value={design.face.mouth} options={[["smile", "Smile"], ["neutral", "Neutral"], ["open", "Open"]]} onChange={value => updateFace("mouth", value)} />
                  <FeatureSelect label="Markings" value={design.face.markings} options={[["none", "None"], ["freckles", "Freckles"], ["forehead_patch", "Forehead patch"]]} onChange={value => updateFace("markings", value)} />
                  <div className="whisker-field"><label className="field-label" htmlFor="whiskers">Whiskers</label><label className="switch-label"><input id="whiskers" type="checkbox" checked={design.face.whiskers} onChange={event => updateFace("whiskers", event.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span><span>{design.face.whiskers ? "On" : "Off"}</span></label></div>
                </div>
                <button type="button" className="secondary-button build-button" onClick={() => void buildPreview()} disabled={!!busy}><RotateCcw className={busy === "render" ? "spin" : ""} size={14} />{busy === "render" ? "Building preview…" : "Build printable preview"}</button>
              </> : <p className="muted empty-features">Your editable features will appear here once a design is loaded.</p>}
              <p className="interpretation-note">A stylised 40 mm box interpretation. Your reference inspires the face; the shape stays simple and foldable.</p>
            </section>
          </aside>

          <section className="preview-panel" aria-label="Companion preview">
            <div className="preview-toolbar"><div className="preview-tabs" role="tablist" aria-label="Preview type"><button id="model-tab" role="tab" aria-selected={tab === "model"} aria-controls="model-panel" className={tab === "model" ? "active" : ""} onClick={() => setTab("model")}><Box size={15} />3D companion</button><button id="net-tab" role="tab" aria-selected={tab === "net"} aria-controls="net-panel" className={tab === "net" ? "active" : ""} onClick={() => setTab("net")}><Layers size={15} />Paper net</button></div><span className="size-chip">40 × 40 × 40 mm</span></div>
            <div className="preview-stage" aria-busy={!!busy}>
              <div className="stage-caption"><span className="source-badge">{source === "example" ? "SAVED EXAMPLE" : source === "ai" ? "AI PERSONALISED" : "MANUALLY EDITED"}</span><h3>{design?.name.trim() || "Your paper companion"}</h3><p>{source === "example" ? "A familiar face to get you started." : "A small character with a personality of its own."}</p></div>
              {rendered && result ? <>
                <div className="model-pane" id="model-panel" role="tabpanel" aria-labelledby="model-tab" hidden={tab !== "model"}>
                  <ModelViewer key={`${rendered.epoch}:${result.model_url}`} modelUrl={result.model_url} onReady={modelReady} onError={modelError} />
                  {modelLoaded && <span className="viewer-hint">Drag to turn · Scroll to zoom</span>}
                </div>
                <div className="net-pane" id="net-panel" role="tabpanel" aria-labelledby="net-tab" hidden={tab !== "net"}><img key={`${rendered.epoch}:${result.preview_url}`} src={result.preview_url} alt={`A4 paper net for ${result.design.name}, returned by the print engine`} onLoad={() => { if (requestEpoch.current === rendered.epoch) setNetLoaded(true); }} onError={() => { if (requestEpoch.current === rendered.epoch) { setNetLoaded(false); setAssetFailure("The paper net could not be loaded. Rebuild the preview to retry."); } }} /><span className="viewer-hint">Single-sided A4 · Solid cuts · Dashed folds</span></div>
              </> : <div className="preview-placeholder"><div className={busy ? "placeholder-icon working" : "placeholder-icon"}>{busy ? <LoaderCircle className="spin" size={33} strokeWidth={1.2} /> : <Box size={43} strokeWidth={1} />}</div><h4>{busy ? progressLabel : "A little space for your companion"}</h4><p>{busy ? "The preview appears when the print engine returns your model." : "Build a preview to see the exact model and paper net from the print engine."}</p>{!busy && design && <button type="button" onClick={() => void buildPreview()}><RotateCcw size={13} />{failure ? "Retry preview" : "Build preview"}</button>}</div>}
              <div className="stage-footer"><span><span className="ink-dot" />Monochrome artwork</span><span>One sheet. Six faces.</span></div>
            </div>

            <div className="print-panel">
              <div className="validation-row"><div className={validationPassed ? "validation-icon passed" : "validation-icon"}>{validationPassed ? <ShieldCheck size={20} /> : <FileText size={20} />}</div><div><h3>{validationPassed ? "Print checks passed" : busy ? "Preparing your paper companion" : "Print checks pending"}</h3><p>{validationPassed ? "Geometry and layout validated by the print engine." : "Your download unlocks after the model and net pass validation."}</p></div>{validationPassed && <button type="button" className="check-detail-button" aria-expanded={showChecks} onClick={() => setShowChecks(!showChecks)}>8 checks <ChevronDown size={13} /></button>}</div>
              {showChecks && validationPassed && <ul className="check-list">{REQUIRED_CHECKS.map(check => <li key={check}><Check size={13} />{checkLabels[check] || check}</li>)}</ul>}
              {(failure || assetFailure) && <div className="error-notice" role="alert"><CircleAlert size={16} /><div><p>{assetFailure || failure?.message}</p>{failure && failure.details.length > 0 && <ul>{failure.details.map((detail, i) => <li key={`${detail}-${i}`}>{checkLabels[detail] || detail}</li>)}</ul>}<button type="button" disabled={!!busy} onClick={() => void buildPreview()}>Retry preview <ArrowRight size={12} /></button></div></div>}
              {progressLabel && <p className="progress-note" role="status"><LoaderCircle className="spin" size={13} />{progressLabel}</p>}
              {result && validationPassed && (!modelLoaded || !netLoaded) && !assetFailure && <p className="progress-note" role="status"><LoaderCircle className="spin" size={13} />Loading the exact 3D model and paper net…</p>}
              <div className="download-row"><div><span className="paper-label">A4 · 1 PAGE · BLACK & WHITE</span><p>Numbered tabs. Ready to cut and fold.</p></div>{canDownload && result ? <a className="download-button" href={result.pdf_url} download={`${result.design.name}.pdf`}><ArrowDownToLine size={17} />Download paper net</a> : <button className="download-button" type="button" disabled><ArrowDownToLine size={17} />Download paper net</button>}</div>
              <p className="print-note">Print the PDF at <strong>100% / actual size</strong>, single-sided. Check its 20 mm scale mark before cutting. Software validation only; physical assembly is still to be checked.</p>
            </div>
          </section>
        </div>

        <section className="assembly-strip" id="assembly" aria-label="How to make your paper companion"><div><span className="small-overline">FROM SCREEN TO DESK</span><h2>A little making goes a long way.</h2></div><ol><li><span>01</span><div><strong>Imagine</strong><p>Describe it, or pick a reference.</p></div></li><li><span>02</span><div><strong>Print & cut</strong><p>A4 paper. Actual size. Follow the lines.</p></div></li><li><span>03</span><div><strong>Fold & befriend</strong><p>Match the numbers. Glue. Say hello.</p></div></li></ol></section>
      </main>
      <footer className="site-footer"><span>foldable AI <span className="footer-separator">/</span> Made for the world outside your screen.</span><span>Small in size. Big in character.<Sparkles size={13} /></span></footer>
    </div>
  );
}

function FeatureSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const id = `feature-${label.toLowerCase()}`;
  return <div><label className="field-label" htmlFor={id}>{label}</label><div className="select-wrap"><select id={id} value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></div></div>;
}
