"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RotateCcw } from "lucide-react";
import styles from "./StudioComponents.module.css";

type Props = { modelUrl: string; onReady?: () => void; onError?: (message: string) => void };

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export default function ModelViewer({ modelUrl, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  const resetRef = useRef<(() => void) | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  callbacks.current = { onReady, onError };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    let frame = 0;
    let loaded: THREE.Object3D | null = null;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let removeContextListener: (() => void) | undefined;
    const abort = new AbortController();
    setStatus("loading");
    setMessage("");

    function fail(text: string) {
      if (!active) return;
      cancelAnimationFrame(frame);
      setStatus("error");
      setMessage(text);
      callbacks.current.onError?.(text);
    }

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;
      renderer.domElement.setAttribute("aria-label", "Printable 3D mascot. Drag to rotate and scroll to zoom.");
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("tabindex", "0");
      const contextLost = (event: Event) => {
        event.preventDefault();
        fail("The 3D display stopped. Retry the preview to reload the printable model.");
      };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      removeContextListener = () => renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd2ccc0, 2.6));
      const key = new THREE.DirectionalLight(0xffffff, 3.2);
      key.position.set(3, 5, 6);
      scene.add(key);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 10000);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.dampingFactor = 0.08;
      const keyboardRotate = (event: KeyboardEvent) => {
        if (!controls || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
        if (event.key === "ArrowLeft") orbit.theta -= 0.15;
        if (event.key === "ArrowRight") orbit.theta += 0.15;
        if (event.key === "ArrowUp") orbit.phi -= 0.15;
        if (event.key === "ArrowDown") orbit.phi += 0.15;
        orbit.makeSafe();
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));
        controls.update();
      };
      renderer.domElement.addEventListener("keydown", keyboardRotate);
      const removePreviousListeners = removeContextListener;
      removeContextListener = () => {
        removePreviousListeners?.();
        renderer?.domElement.removeEventListener("keydown", keyboardRotate);
      };
      const handleSize = () => {
        if (!renderer) return;
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        resetRef.current?.();
      };
      resizeObserver = new ResizeObserver(handleSize);
      resizeObserver.observe(host);
      handleSize();
      const gltfLoader = new GLTFLoader();

      void (async () => {
        try {
          const response = await fetch(modelUrl, { signal: abort.signal });
          if (!response.ok) throw new Error("model request failed");
          const buffer = await response.arrayBuffer();
          const gltf = await gltfLoader.parseAsync(buffer, new URL(".", new URL(modelUrl, window.location.href)).href);
          if (!active) {
            disposeObject(gltf.scene);
            return;
          }
          loaded = gltf.scene;
          const bounds = new THREE.Box3().setFromObject(loaded);
          const center = bounds.getCenter(new THREE.Vector3());
          const size = bounds.getSize(new THREE.Vector3());
          const diameter = size.length();
          if (bounds.isEmpty() || !Number.isFinite(diameter) || diameter <= 0) throw new Error("empty model");
          scene.add(loaded);
          const fit = () => {
            if (!controls) return;
            const verticalFov = THREE.MathUtils.degToRad(camera.fov);
            const fitDistance = diameter / (2 * Math.tan(verticalFov / 2)) / Math.min(camera.aspect, 1);
            camera.near = diameter / 1000;
            camera.far = fitDistance * 100;
            camera.position.copy(center).add(new THREE.Vector3(0.65, 0.38, 1.5).normalize().multiplyScalar(fitDistance * 1.15));
            camera.updateProjectionMatrix();
            controls.target.copy(center);
            controls.minDistance = diameter * 0.65;
            controls.maxDistance = fitDistance * 4;
            controls.update();
            controls.saveState();
          };
          resetRef.current = fit;
          fit();
          let firstFrame = true;
          const animate = () => {
            if (!active || !renderer || !controls) return;
            try {
              controls.update();
              renderer.render(scene, camera);
              if (firstFrame) {
                firstFrame = false;
                setStatus("ready");
                callbacks.current.onReady?.();
              }
              frame = requestAnimationFrame(animate);
            } catch {
              fail("The 3D model could not be displayed. Retry the preview.");
            }
          };
          animate();
        } catch {
          if (active && !abort.signal.aborted) fail("The printable 3D model could not be loaded. Check the geometry service and retry.");
        }
      })();
    } catch {
      fail("Your browser could not start the 3D display. Enable WebGL or try another browser.");
    }

    return () => {
      active = false;
      abort.abort();
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      removeContextListener?.();
      controls?.dispose();
      if (loaded) disposeObject(loaded);
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
      resetRef.current = null;
    };
  }, [modelUrl, attempt]);

  return <div className={styles.viewer}>
    <div className={styles.canvasHost} ref={hostRef} />
    {status === "loading" && <div className={styles.viewerOverlay} role="status"><span className={styles.spinner} />Loading the printable model…</div>}
    {status === "error" && <div className={styles.viewerOverlay} role="alert"><p>{message}</p><button type="button" className={styles.smallButton} onClick={() => setAttempt((value) => value + 1)}>Retry 3D preview</button></div>}
    {status === "ready" && <><button type="button" className={styles.resetButton} onClick={() => resetRef.current?.()} aria-label="Reset 3D view"><RotateCcw size={15} /> Reset view</button><p className={styles.viewerHint}>Drag or use arrow keys to rotate · Scroll to zoom</p></>}
  </div>;
}
