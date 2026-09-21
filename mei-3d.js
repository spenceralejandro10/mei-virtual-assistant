import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("mei3dCanvas");
const shell = document.querySelector(".mei-3d-shell");
const loading = document.getElementById("mei3dLoading");

if (!canvas || !shell) throw new Error("Mei 3D canvas not found");

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);

const hemi = new THREE.HemisphereLight(0xf8f6ff, 0x31384d, 2.15);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.8);
key.position.set(3.2, 5.5, 4.5);
key.castShadow = true;
scene.add(key);

const fill = new THREE.DirectionalLight(0x91adff, 1.15);
fill.position.set(-4, 2.8, 3);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xb986ff, 1.0);
rim.position.set(2, 3.6, -4);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1.4, 48),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.16 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.006;
floor.receiveShadow = true;
scene.add(floor);

let model = null;
let mixer = null;
let activeAction = null;
let stateName = "idle";
let modelReady = false;
let procedural = true;
let speaking = false;
let modelSize = new THREE.Vector3(1, 3, 1);
let lookX = 0;
let lookY = 0;

const clock = new THREE.Clock();
const rig = {};
const baseQuat = {};
const targetQuat = {};
const tempEuler = new THREE.Euler();
const tempQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();

const boneMap = {
  root: "root",
  chest: "spine03",
  upperChest: "spine04",
  neck: "neck03",
  head: "head",
  jaw: "jaw",
  clavicleL: "clavicle.L",
  clavicleR: "clavicle.R",
  upperArmL: "upperarm01.L",
  lowerArmL: "lowerarm01.L",
  wristL: "wrist.L",
  upperArmR: "upperarm01.R",
  lowerArmR: "lowerarm01.R",
  wristR: "wrist.R",
  thighL: "upperleg01.L",
  shinL: "lowerleg01.L",
  footL: "foot.L",
  thighR: "upperleg01.R",
  shinR: "lowerleg01.R",
  footR: "foot.R"
};

const naturalPose = {
  clavicleL: [0, 0, 0.035],
  clavicleR: [0, 0, -0.035],
  upperArmL: [-0.03, 0.04, 0.34],
  lowerArmL: [0.02, 0.02, 0.08],
  wristL: [0, 0.015, 0.025],
  upperArmR: [-0.03, -0.04, -0.34],
  lowerArmR: [0.02, -0.02, -0.08],
  wristR: [0, -0.015, -0.025],
  thighL: [0.01, 0, 0.012],
  thighR: [-0.01, 0, -0.012],
  chest: [0.005, 0, 0],
  upperChest: [-0.004, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  jaw: [0, 0, 0]
};

const clipPatterns = {
  idle: /idle|stand|breath/i,
  wave: /wave|hello|greet/i,
  think: /think|ponder/i,
  dance: /dance/i,
  sleep: /sleep|rest/i,
  celebrate: /celebr|cheer|victory|happy/i,
  listen: /listen|idle|stand/i,
  speak: /talk|speak/i
};

function updateSize() {
  const w = Math.max(1, shell.clientWidth);
  const h = Math.max(1, shell.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (modelReady) fitCamera();
}

function fitCamera() {
  if (!model) return;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.2));
  const fitHeight = (modelSize.y * 0.5) / Math.tan(verticalFov / 2);
  const fitWidth = (modelSize.x * 0.5) / Math.tan(horizontalFov / 2);
  const distance = Math.max(fitHeight, fitWidth) * 1.08;
  const focusY = modelSize.y * 0.51;

  camera.position.set(0, focusY, distance);
  camera.lookAt(0, focusY, 0);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(50, distance * 8);
  camera.updateProjectionMatrix();
}

function normalizeModel(root) {
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  if (size.y > 0) {
    const targetHeight = 3.65;
    root.scale.setScalar(targetHeight / size.y);
  }

  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());

  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  modelSize = box.getSize(new THREE.Vector3());

  floor.scale.setScalar(Math.max(1, modelSize.x * 0.62));
  fitCamera();
}

function normalizedBoneName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function setupRig() {
  const bones = [];
  model.traverse(obj => {
    if (obj.isBone) bones.push(obj);
  });

  Object.entries(boneMap).forEach(([role, expectedName]) => {
    const expected = normalizedBoneName(expectedName);
    let bone = model.getObjectByName(expectedName);

    if (!bone || !bone.isBone) {
      bone = bones.find(candidate => normalizedBoneName(candidate.name) === expected);
    }

    if (!bone) {
      bone = bones.find(candidate => {
        const actual = normalizedBoneName(candidate.name);
        return actual.endsWith(expected) || expected.endsWith(actual);
      });
    }

    if (!bone || !bone.isBone) return;

    rig[role] = bone;
    baseQuat[role] = bone.quaternion.clone();
    targetQuat[role] = bone.quaternion.clone();
  });
}

function addPose(map, role, x = 0, y = 0, z = 0) {
  if (!map[role]) map[role] = [0, 0, 0];
  map[role][0] += x;
  map[role][1] += y;
  map[role][2] += z;
}

function desiredPose(name, t) {
  const pose = {};
  Object.entries(naturalPose).forEach(([role, value]) => {
    pose[role] = [...value];
  });

  const breathe = Math.sin(t * 1.75);
  const sway = Math.sin(t * 0.72);
  const beat = Math.sin(t * 5.4);
  const fast = Math.sin(t * 8.1);

  // Always-on organic micro motion.
  addPose(pose, "chest", 0.010 * breathe, 0.006 * sway, 0.009 * breathe);
  addPose(pose, "upperChest", -0.006 * breathe, 0.004 * sway, -0.005 * breathe);
  addPose(pose, "neck", 0.005 * breathe, lookX * 0.025, 0.004 * sway);
  addPose(pose, "head", lookY * 0.035, lookX * 0.07 + 0.012 * sway, 0.012 * Math.sin(t * 0.47));
  addPose(pose, "upperArmL", 0, 0, 0.012 * breathe);
  addPose(pose, "upperArmR", 0, 0, -0.012 * breathe);

  switch (name) {
    case "wave":
      addPose(pose, "upperArmR", -0.20, -0.18, -0.95);
      addPose(pose, "lowerArmR", -0.15, -0.10, -0.90 + fast * 0.28);
      addPose(pose, "wristR", 0.02, fast * 0.24, fast * 0.16);
      addPose(pose, "head", 0, -0.03, -0.045);
      addPose(pose, "chest", 0, 0, -0.028);
      break;

    case "think":
      addPose(pose, "upperArmR", -0.10, -0.26, -0.64);
      addPose(pose, "lowerArmR", -0.16, -0.10, -1.04);
      addPose(pose, "wristR", 0.14, 0.05, -0.05);
      addPose(pose, "head", 0.04, -0.06, 0.12 + sway * 0.02);
      addPose(pose, "chest", 0, 0, -0.035);
      break;

    case "dance":
      addPose(pose, "chest", 0, beat * 0.09, beat * 0.13);
      addPose(pose, "upperChest", 0, -beat * 0.07, beat * 0.07);
      addPose(pose, "head", 0, -beat * 0.11, -beat * 0.07);
      addPose(pose, "upperArmR", -0.20, -0.12, -0.62 - sway * 0.32);
      addPose(pose, "lowerArmR", 0, 0, -0.42 + fast * 0.24);
      addPose(pose, "upperArmL", -0.20, 0.12, 0.62 + sway * 0.32);
      addPose(pose, "lowerArmL", 0, 0, 0.42 - fast * 0.24);
      addPose(pose, "thighR", beat * 0.16, 0, -0.07);
      addPose(pose, "thighL", -beat * 0.16, 0, 0.07);
      addPose(pose, "shinR", Math.max(0, -beat) * 0.18, 0, 0);
      addPose(pose, "shinL", Math.max(0, beat) * 0.18, 0, 0);
      break;

    case "celebrate":
      addPose(pose, "upperArmR", -0.26, -0.09, -1.20 + sway * 0.08);
      addPose(pose, "lowerArmR", 0, 0, -0.30 + fast * 0.12);
      addPose(pose, "upperArmL", -0.26, 0.09, 1.20 - sway * 0.08);
      addPose(pose, "lowerArmL", 0, 0, 0.30 - fast * 0.12);
      addPose(pose, "chest", 0, beat * 0.04, beat * 0.05);
      addPose(pose, "head", 0, 0, -beat * 0.04);
      break;

    case "sleep":
      addPose(pose, "head", 0.07, 0, 0.20 + sway * 0.012);
      addPose(pose, "neck", 0.025, 0, 0.07);
      addPose(pose, "chest", 0, 0, 0.05);
      addPose(pose, "upperArmR", 0, 0, 0.12);
      addPose(pose, "upperArmL", 0, 0, -0.12);
      break;

    case "listen":
      addPose(pose, "head", 0, 0.035, -0.09 + sway * 0.016);
      addPose(pose, "neck", 0, 0, -0.03);
      break;

    case "speak":
      // Speaking is also handled as an overlay below.
      break;

    case "idle":
    default:
      break;
  }

  if (speaking || name === "speak") {
    const speechBeat = (Math.sin(t * 13.0) + Math.sin(t * 7.4) * 0.45 + 1.45) / 2.9;
    const phrase = Math.sin(t * 2.25);
    const gesture = Math.sin(t * 1.18);
    const gestureGate = Math.max(0, Math.sin(t * 0.82));

    addPose(pose, "jaw", 0.035 + speechBeat * 0.095, 0, 0);
    addPose(pose, "head", 0.012 * phrase, 0.020 * gesture, 0.012 * Math.sin(t * 1.55));
    addPose(pose, "neck", -0.005 * phrase, 0.008 * gesture, 0);
    addPose(pose, "chest", 0.010 * phrase, 0.012 * gesture, 0.008 * phrase);
    addPose(pose, "upperChest", -0.006 * phrase, -0.010 * gesture, 0);

    // Gentle conversational hand gestures that come and go instead of constant flapping.
    addPose(pose, "upperArmR", -0.025 * gestureGate, -0.02, -0.10 * gestureGate);
    addPose(pose, "lowerArmR", 0.02 * gestureGate, 0.02, -0.18 * gestureGate);
    addPose(pose, "wristR", 0, 0.05 * gesture, -0.04 * gestureGate);

    const leftGate = Math.max(0, Math.sin(t * 0.82 + Math.PI));
    addPose(pose, "upperArmL", -0.018 * leftGate, 0.015, 0.07 * leftGate);
    addPose(pose, "lowerArmL", 0.015 * leftGate, -0.015, 0.11 * leftGate);
  }

  return pose;
}

function applyPose(pose, dt) {
  const alpha = 1 - Math.exp(-Math.max(dt, 0.001) * 10.5);

  Object.entries(rig).forEach(([role, bone]) => {
    const base = baseQuat[role];
    if (!base) return;

    const [x, y, z] = pose[role] || naturalPose[role] || [0, 0, 0];
    tempEuler.set(x, y, z, "XYZ");
    tempQuat.setFromEuler(tempEuler);
    targetQuat[role].copy(base).multiply(tempQuat);
    bone.quaternion.slerp(targetQuat[role], alpha);
  });
}

function findClip(name) {
  if (!mixer || !model?.userData?.clips?.length) return null;
  const rx = clipPatterns[name];
  if (!rx) return null;
  return model.userData.clips.find(clip => rx.test(clip.name || ""));
}

function useNativeClip(name) {
  const clip = findClip(name);
  if (!clip || speaking) return false;

  procedural = false;
  if (activeAction) activeAction.fadeOut(0.15);

  activeAction = mixer.clipAction(clip);
  activeAction.reset();
  activeAction.enabled = true;
  activeAction.setEffectiveWeight(1);
  activeAction.setEffectiveTimeScale(1);
  activeAction.setLoop(
    ["idle", "listen", "sleep"].includes(name) ? THREE.LoopRepeat : THREE.LoopOnce,
    Infinity
  );
  activeAction.clampWhenFinished = !["idle", "listen", "sleep"].includes(name);
  activeAction.fadeIn(0.16).play();
  return true;
}

function setState(name = "idle") {
  stateName = name;
  if (!modelReady) return;

  if (activeAction) {
    activeAction.fadeOut(0.12);
    activeAction = null;
  }
  procedural = !useNativeClip(name);
}

function setSpeaking(active) {
  speaking = Boolean(active);
  if (speaking && activeAction) {
    activeAction.stop();
    activeAction = null;
    procedural = true;
  }
}

function projectedBounds() {
  if (!model) return null;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        tmpVec.set(x, y, z).project(camera);
        min.x = Math.min(min.x, tmpVec.x);
        min.y = Math.min(min.y, tmpVec.y);
        min.z = Math.min(min.z, tmpVec.z);
        max.x = Math.max(max.x, tmpVec.x);
        max.y = Math.max(max.y, tmpVec.y);
        max.z = Math.max(max.z, tmpVec.z);
      }
    }
  }

  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z }
  };
}

function quaternionSnapshot(role) {
  const bone = rig[role];
  if (!bone) return null;
  return {
    x: bone.quaternion.x,
    y: bone.quaternion.y,
    z: bone.quaternion.z,
    w: bone.quaternion.w
  };
}

function boneProjection(role) {
  const bone = rig[role];
  if (!bone) return null;
  bone.getWorldPosition(tmpVec);
  tmpVec.project(camera);
  return { x: tmpVec.x, y: tmpVec.y, z: tmpVec.z };
}

function diagnostics() {
  const required = ["head", "jaw", "chest", "upperArmL", "upperArmR", "thighL", "thighR"];
  return {
    ready: modelReady,
    state: stateName,
    speaking,
    requiredBonesPresent: required.every(role => Boolean(rig[role])),
    missingBones: required.filter(role => !rig[role]),
    bones: Object.keys(rig),
    animations: model?.userData?.clips?.map(a => a.name) || [],
    modelSize: { x: modelSize.x, y: modelSize.y, z: modelSize.z },
    camera: {
      fov: camera.fov,
      aspect: camera.aspect,
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }
    },
    projectedBounds: projectedBounds(),
    headProjected: boneProjection("head"),
    rootProjected: boneProjection("root"),
    snapshots: {
      head: quaternionSnapshot("head"),
      jaw: quaternionSnapshot("jaw"),
      upperArmR: quaternionSnapshot("upperArmR"),
      thighR: quaternionSnapshot("thighR")
    }
  };
}

function render() {
  requestAnimationFrame(render);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (modelReady) {
    if (!procedural && mixer && !speaking) {
      mixer.update(dt);
    } else {
      applyPose(desiredPose(stateName, elapsed), dt);
    }
  }

  renderer.render(scene, camera);
}

const loader = new GLTFLoader();
loader.load(
  "./assets/mei-yinn.glb",
  gltf => {
    model = gltf.scene;
    model.userData.clips = gltf.animations || [];

    model.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = true;

      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => {
        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      });
    });

    scene.add(model);
    normalizeModel(model);
    setupRig();

    mixer = new THREE.AnimationMixer(model);
    modelReady = true;
    window.__MEI_3D_READY__ = true;

    if (loading) loading.classList.add("ready");
    shell.classList.add("is-ready");

    setState(stateName);

    window.dispatchEvent(new CustomEvent("mei3d-ready", {
      detail: diagnostics()
    }));
  },
  progress => {
    if (!loading || !progress.total) return;
    const pct = Math.min(99, Math.round((progress.loaded / progress.total) * 100));
    loading.innerHTML = "<span></span> Cargando cuerpo 3D… " + pct + "%";
  },
  error => {
    console.error("Mei GLB load failed", error);
    window.__MEI_3D_READY__ = false;
    if (loading) {
      loading.classList.add("error");
      loading.textContent = "No se pudo cargar el cuerpo 3D";
    }
    window.dispatchEvent(new CustomEvent("mei3d-error"));
  }
);

window.Mei3D = {
  setState,
  setSpeaking,
  isReady: () => modelReady,
  getAnimations: () => model?.userData?.clips?.map(a => a.name) || [],
  getDiagnostics: diagnostics
};

window.addEventListener("pointermove", event => {
  const rect = shell.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
  lookX = THREE.MathUtils.clamp(x, -1, 1);
  lookY = THREE.MathUtils.clamp(-y, -1, 1);
}, { passive: true });

window.addEventListener("resize", updateSize);
new ResizeObserver(updateSize).observe(shell);
updateSize();
render();
