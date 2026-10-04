"use client";

import { useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type ChampionModel = {
  champion: string;
  alias: string;
  skinId: number;
  model: string;
  portrait: string | null;
};
export type ChampionStageStatus = "loading" | "ready" | "error";
export type ChampionStageHandle = { capture(): Promise<File> };

const FOV = 30;
const MARGIN = 1.08;
const CAPTURE_HEIGHT = 1024;
const AUTO_ROTATE_RESUME_MS = 2500;
const BOUNDS_SAMPLES = 8;

type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  loader: GLTFLoader;
  // Normalized bounds of the loaded champion: height 1, centred on the origin.
  bounds: THREE.Box3 | null;
  champion: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
};

const BLOCKED_IDLE_WORDS = new Set(["in", "out", "turn", "to", "recall"]);

function pickIdleClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | undefined {
  const isCleanIdle = (name: string) => {
    const lower = name.toLowerCase();
    if (!/^idle/.test(lower)) return false;
    if (lower.includes("turn") || lower.includes("recall") || lower.includes("_to")) return false;
    return !lower.split(/[^a-z0-9]+/).some((word) => BLOCKED_IDLE_WORDS.has(word));
  };
  return (
    clips.find((clip) => isCleanIdle(clip.name)) ??
    clips.find((clip) => clip.name.toLowerCase().includes("idle")) ??
    clips[0]
  );
}

// Union of the posed skinned bounds across the idle loop, so a swinging tail or
// weapon never leaves the frame.
function idleBounds(root: THREE.Object3D, mixer: THREE.AnimationMixer, clip: THREE.AnimationClip | undefined) {
  const box = new THREE.Box3();
  const sample = new THREE.Box3();
  const duration = clip?.duration ?? 0;
  const samples = duration > 0 ? BOUNDS_SAMPLES : 1;
  for (let i = 0; i < samples; i++) {
    mixer.setTime((duration * i) / samples);
    root.updateMatrixWorld(true);
    box.union(sample.setFromObject(root, true));
  }
  mixer.setTime(0);
  return box;
}

// Camera distance that fits `halfWidth` x `halfHeight` (around the origin) with
// `depth` extending toward the camera.
function fitDistance(halfWidth: number, halfHeight: number, depth: number, aspect: number) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  return Math.max(halfHeight / tanHalf, halfWidth / (tanHalf * aspect)) * MARGIN + depth;
}

function frame(stage: Stage, aspect: number) {
  const { bounds, camera, controls } = stage;
  camera.aspect = aspect;
  if (bounds) {
    const size = bounds.getSize(new THREE.Vector3());
    // Orbiting exposes the side profile, so fit the widest horizontal extent.
    const halfWidth = Math.max(size.x, size.z) / 2;
    const distance = fitDistance(halfWidth, size.y / 2, halfWidth, aspect);
    const offset = camera.position.clone().sub(controls.target);
    offset.y = 0;
    if (offset.lengthSq() === 0) offset.set(0, 0, 1);
    camera.position.copy(offset.setLength(distance));
    camera.near = distance / 100;
    camera.far = distance * 10;
  }
  camera.updateProjectionMatrix();
  controls.update();
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.dispose();
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export function ChampionStage({
  model,
  className,
  onStatus,
  ref,
}: {
  model: ChampionModel;
  className?: string;
  onStatus?: (status: ChampionStageStatus, detail?: string) => void;
  ref?: React.Ref<ChampionStageHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const onStatusRef = useRef(onStatus);
  const aliasRef = useRef(model.alias);

  useEffect(() => {
    onStatusRef.current = onStatus;
    aliasRef.current = model.alias;
  });

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(1, 2, 3);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
    camera.position.set(0, 0, 4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    const pauseAutoRotate = () => {
      clearTimeout(resumeTimer);
      controls.autoRotate = false;
    };
    const scheduleAutoRotate = () => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => (controls.autoRotate = true), AUTO_ROTATE_RESUME_MS);
    };
    controls.addEventListener("start", pauseAutoRotate);
    controls.addEventListener("end", scheduleAutoRotate);

    const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);

    const stage: Stage = { renderer, scene, camera, controls, loader, bounds: null, champion: null, mixer: null };
    stageRef.current = stage;

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      frame(stage, width / height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      stage.mixer?.update(delta);
      controls.update(delta);
      renderer.render(scene, camera);
    });

    return () => {
      clearTimeout(resumeTimer);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      ktx2.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current!;
    let cancelled = false;
    let champion: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;

    onStatusRef.current?.("loading");
    stage.loader
      .loadAsync(model.model)
      .then((gltf) => {
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        const root = gltf.scene;
        mixer = new THREE.AnimationMixer(root);
        const clip = pickIdleClip(gltf.animations);
        if (clip) mixer.clipAction(clip).play();

        const box = idleBounds(root, mixer, clip);
        const height = box.max.y - box.min.y;
        if (!Number.isFinite(height) || height <= 0) throw new Error("Model has no visible geometry");
        const scale = 1 / height;
        const center = box.getCenter(new THREE.Vector3());
        root.scale.multiplyScalar(scale);
        root.position.sub(center).multiplyScalar(scale);

        champion = root;
        stage.scene.add(root);
        stage.champion = root;
        stage.mixer = mixer;
        stage.bounds = new THREE.Box3(
          box.min.clone().sub(center).multiplyScalar(scale),
          box.max.clone().sub(center).multiplyScalar(scale),
        );
        stage.camera.position.set(0, 0, 1);
        stage.controls.target.set(0, 0, 0);
        frame(stage, stage.camera.aspect);
        onStatusRef.current?.("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onStatusRef.current?.("error", error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(mixer.getRoot());
      }
      if (stage.mixer === mixer) stage.mixer = null;
      if (champion) {
        stage.scene.remove(champion);
        disposeObject(champion);
        stage.champion = null;
        stage.bounds = null;
      }
    };
  }, [model.model]);

  useImperativeHandle(
    ref,
    () => ({
      capture() {
        const stage = stageRef.current;
        if (!stage?.champion) return Promise.reject(new Error("Champion is not loaded yet"));
        const { renderer, scene, camera, champion } = stage;
        // Frame the pose on screen right now, tighter than the idle-loop bounds the live view uses.
        const pose = new THREE.Box3().setFromObject(champion, true);
        const size = pose.getSize(new THREE.Vector3());
        const center = pose.getCenter(new THREE.Vector3());
        const aspect = size.x / size.y;
        const width = Math.round(CAPTURE_HEIGHT * aspect);

        const savedPosition = camera.position.clone();
        const savedAspect = camera.aspect;
        const savedPixelRatio = renderer.getPixelRatio();
        const savedSize = renderer.getSize(new THREE.Vector2());

        renderer.setPixelRatio(1);
        renderer.setSize(width, CAPTURE_HEIGHT, false);
        camera.aspect = aspect;
        camera.position.set(center.x, center.y, center.z + fitDistance(size.x / 2, size.y / 2, size.z / 2, aspect));
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);

        // toBlob snapshots the drawing buffer synchronously, before the restore below.
        const blob = new Promise<Blob | null>((resolve) => renderer.domElement.toBlob(resolve, "image/png"));

        renderer.setPixelRatio(savedPixelRatio);
        renderer.setSize(savedSize.x, savedSize.y, false);
        camera.position.copy(savedPosition);
        camera.aspect = savedAspect;
        camera.lookAt(stage.controls.target);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);

        const alias = aliasRef.current;
        return blob.then((png) => {
          if (!png) throw new Error("Capture produced no image");
          return new File([png], `${alias}-3d.png`, { type: "image/png" });
        });
      },
    }),
    [],
  );

  return <div ref={containerRef} className={className} />;
}
