"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, Box, Check, ChevronDown, CircleAlert,
  LoaderCircle, RotateCcw,
} from "lucide-react";
import ModelViewer from "@/components/ModelViewer";
import ImageCropper from "@/components/ImageCropper";
import PetSelector from "@/components/PetSelector";
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
  const [inputType, setInputType] = useState<InputType>("chatgpt_pet");
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [selectedPet, setSelectedPet] = useState<{ id: string; name: string } | null>(null);
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [source, setSource] = useState<Source>("example");
  const [rendered, setRendered] = useState<RenderRecord | null>(null);
  const [busy, setBusy] = useState<Busy>("example");
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
        body: JSON.stringify({ input_type: inputType, text: inputType === "chatgpt_pet" && selectedPet ? `Pet name: ${selectedPet.name}. ${text}`.slice(0, 2000) : text, image_data_url: inputType === "text" ? null : image }), signal,
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
  const receiveImage = useCallback((dataUrl: string | null) => { invalidate(); setImage(dataUrl); setSelectedPet(null); }, [invalidate]);
  const receivePet = useCallback((dataUrl: string | null, pet?: { id: string; name: string }) => {
    invalidate();
    setImage(dataUrl);
    setSelectedPet(dataUrl && pet ? pet : null);
  }, [invalidate]);
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
  const validationPassed = !!rendered && rendered.epoch === requestEpoch.current && !!result && result.validation.status === "passed" && REQUIRED_CHECKS.every(check => result.validation.checks.includes(check));
  const canDownload = validationPassed && modelLoaded && netLoaded && !busy && !failure && !modelFailure && !netFailure;
  const canInterpret = !busy && aiConfigured !== false && (inputType === "text" ? text.trim().length > 0 : !!image);
  const progressLabel = busy === "example" ? "Loading the saved design…" : busy === "ai" ? "Interpreting your reference…" : busy === "render" ? "Building assets and checking the net…" : null;

  // The GLB viewer presents its own retryable model error.
  const visibleError = failure?.message || netFailure;
  const sourceLabel = source === "example" ? "Saved example" : source === "manual" ? "Edited design" : "AI interpretation";

  return (
    <div className="studio">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Foldable AI home"><Box size={23} strokeWidth={1.5} />foldable <span>AI</span></a>
        <button className="text-button" type="button" onClick={() => void loadExample()} disabled={!!busy}>Use example</button>
      </header>
      <main>
        <h1>Turn a pet or idea into paper.</h1>
        <div className="workspace">
          <aside className="editor-panel" aria-label="Design your companion">
            <form onSubmit={generate}>
              <div className="input-tabs" aria-label="Reference type">
                {([{ id: "chatgpt_pet", label: "ChatGPT pets" }, { id: "photo", label: "Image" }, { id: "text", label: "Text" }] as const).map(item => (
                  <button key={item.id} type="button" className={inputType === item.id ? "active" : ""} aria-pressed={inputType === item.id} onClick={() => {
                    if (inputType !== item.id) { invalidate(); setInputType(item.id); setImage(null); setSelectedPet(null); }
                  }}>{item.label}</button>
                ))}
              </div>
              {inputType === "chatgpt_pet" && <PetSelector onChange={receivePet} disabled={!!busy} />}
              {inputType === "photo" && <ImageCropper onChange={receiveImage} disabled={!!busy} />}
              {inputType === "text" ? <div className="description-field">
                <label className="field-label" htmlFor="description">Describe your character</label>
                <textarea id="description" value={text} maxLength={2000} rows={5} placeholder="A sleepy robot with freckles…" onChange={event => { invalidate(); setText(event.target.value); }} />
              </div> : <details className="note-details"><summary>Add a note <ChevronDown size={14} /></summary><label className="sr-only" htmlFor="description">Optional guidance</label><textarea id="description" value={text} maxLength={2000} rows={2} placeholder="Keep the sleepy eyes…" onChange={event => { invalidate(); setText(event.target.value); }} /></details>}
              <button className="primary-button" type="submit" disabled={!canInterpret}>{busy === "ai" ? <LoaderCircle className="spin" size={16} /> : null}{busy === "ai" ? "Interpreting…" : "Make paper pet"}</button>
              {aiConfigured === false && <p className="setup-note">AI setup is missing. You can use the example and adjust its features.</p>}
            </form>
            {design && <details className="features-details">
              <summary>Adjust features <ChevronDown size={14} /></summary>
              <div className="features-content">
                <label className="field-label" htmlFor="companion-name">Name</label>
                <input id="companion-name" value={design.name} maxLength={48} onChange={event => updateDesign({ ...design, name: event.target.value })} />
                <div className="feature-grid">
                  <FeatureSelect label="Eyes" value={design.face.eyes} options={[["round", "Round"], ["sleepy", "Sleepy"], ["happy", "Happy"]]} onChange={value => updateFace("eyes", value)} />
                  <FeatureSelect label="Mouth" value={design.face.mouth} options={[["smile", "Smile"], ["neutral", "Neutral"], ["open", "Open"]]} onChange={value => updateFace("mouth", value)} />
                  <FeatureSelect label="Markings" value={design.face.markings} options={[["none", "None"], ["freckles", "Freckles"], ["forehead_patch", "Forehead patch"]]} onChange={value => updateFace("markings", value)} />
                  <label className="checkbox-label"><input id="whiskers" type="checkbox" checked={design.face.whiskers} onChange={event => updateFace("whiskers", event.target.checked)} />Whiskers</label>
                </div>
                <button type="button" className="secondary-button" onClick={() => void buildPreview()} disabled={!!busy}><RotateCcw size={14} />Update preview</button>
              </div>
            </details>}
            <p className="interpretation-note">A stylised 40 mm box model.</p>
          </aside>

          <section className="preview-panel" aria-label="Companion preview">
            <div className="preview-toolbar">
              <div className="preview-name"><h2>{design?.name.trim() || "Your paper pet"}</h2><span>{sourceLabel}</span></div>
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
              </> : <div className="preview-placeholder">{busy ? <LoaderCircle className="spin" size={25} strokeWidth={1.5} /> : <Box size={36} strokeWidth={1} />}<p role={busy ? "status" : undefined}>{busy ? progressLabel : "Your model will appear here."}</p></div>}
            </div>
            <div className="print-panel">
              {visibleError && <div className="error-notice" role="alert"><CircleAlert size={16} /><div><p>{visibleError}</p>{failure && failure.details.length > 0 && <ul>{failure.details.map((detail, index) => <li key={`${detail}-${index}`}>{checkLabels[detail] || detail}</li>)}</ul>}<button type="button" className="text-button" disabled={!!busy} onClick={() => void buildPreview()}>Retry preview</button></div></div>}
              {result && validationPassed && (!modelLoaded || !netLoaded) && !visibleError && !modelFailure && <p className="progress-note" role="status"><LoaderCircle className="spin" size={14} />Loading model and net…</p>}
              <div className="download-row">
                <details className="validation-details"><summary><span className={validationPassed ? "status-dot passed" : "status-dot"} />{validationPassed ? "Print checks passed" : "Print checks pending"}<ChevronDown size={13} /></summary><div><ul>{REQUIRED_CHECKS.map(check => <li key={check}>{validationPassed ? <Check size={12} /> : <span className="check-placeholder" />}{checkLabels[check]}</li>)}</ul><p>Software validation only. Physical assembly has not been checked.</p></div></details>
                {canDownload && result ? <a className="download-button" href={result.pdf_url} download={`${result.design.name}.pdf`}><ArrowDownToLine size={16} />Download PDF</a> : <button className="download-button" type="button" disabled><ArrowDownToLine size={16} />Download PDF</button>}
              </div>
              <p className="print-note">A4 · Single-sided · Print at 100% / actual size.</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function FeatureSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const id = `feature-${label.toLowerCase()}`;
  return <div><label className="field-label" htmlFor={id}>{label}</label><div className="select-wrap"><select id={id} value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></div></div>;
}
