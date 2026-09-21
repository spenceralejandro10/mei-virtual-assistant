import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("mei3dCanvas");
const shell = document.querySelector(".mei-3d-shell");
const loading = document.getElementById("mei3dLoading");

if (!canvas || !shell) {
  throw new Error("Mei 3D canvas not found");
}

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

const hemi = new THREE.HemisphereLight(0xf8f6ff, 0x31384d, 2.35);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 3.1);
key.position.set(3.2, 5.5, 4.5);
key.castShadow = true;
scene.add(key);

const fill = new THREE.DirectionalLight(0x8aa8ff, 1.25);
fill.position.set(-4, 2.6, 3);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xb986ff, 1.15);
rim.position.set(2, 3.4, -4);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1.4, 48),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.19 })
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
const clock = new THREE.Clock();
const rig = {};
const baseQuat = {};
const tempEuler = new THREE.Euler();
const tempQuat = new THREE.Quaternion();

const boneMap = {
  root: "root",
  chest: "spine03",
  upperChest: "spine04",
  neck: "neck03",
  head: "head",
  jaw: "jaw",
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

const clipPatterns = {
  idle: /idle|stand|breath/i,
  wave: /wave|hello|greet/i,
  think: /think|ponder/i,
  dance: /dance/i,
  sleep: /sleep|rest/i,
  celebrate: /celebr|cheer|victory|happy/i,
  listen: /listen|idle|stand/i,
  speak: /talk|speak|idle|stand/i
};

function updateSize() {
  const w = Math.max(1, shell.clientWidth);
  const h = Math.max(1, shell.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function normalizeModel(root) {
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0) {
    const targetHeight = 3.65;
    const scale = targetHeight / size.y;
    root.scale.setScalar(scale);
  }

  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const finalSize = box.getSize(new THREE.Vector3());
  const bodyY = finalSize.y * 0.51;

  camera.position.set(0, bodyY, finalSize.y * 1.46);
  camera.lookAt(0, bodyY, 0);
  camera.near = Math.max(0.01, finalSize.y / 100);
  camera.far = finalSize.y * 20;
  camera.updateProjectionMatrix();

  floor.scale.setScalar(Math.max(1, finalSize.x * 0.62));
}

function setupRig() {
  Object.entries(boneMap).forEach(([role, name]) => {
    const bone = model.getObjectByName(name);
    if (!bone || !bone.isBone) return;
    rig[role] = bone;
    baseQuat[role] = bone.quaternion.clone();
  });
}

function resetPose() {
  Object.keys(rig).forEach(role => {
    if (baseQuat[role]) rig[role].quaternion.copy(baseQuat[role]);
  });
}

function rotate(role, x = 0, y = 0, z = 0) {
  const bone = rig[role];
  const base = baseQuat[role];
  if (!bone || !base) return;
  bone.quaternion.copy(base);
  tempEuler.set(x, y, z, "XYZ");
  tempQuat.setFromEuler(tempEuler);
  bone.quaternion.multiply(tempQuat);
}

function offset(role, x = 0, y = 0, z = 0) {
  const bone = rig[role];
  if (!bone) return;
  tempEuler.set(x, y, z, "XYZ");
  tempQuat.setFromEuler(tempEuler);
  bone.quaternion.multiply(tempQuat);
}

function findClip(name) {
  if (!mixer || !model?.userData?.clips?.length) return null;
  const rx = clipPatterns[name];
  if (!rx) return null;
  return model.userData.clips.find(clip => rx.test(clip.name || ""));
}

function useNativeClip(name) {
  const clip = findClip(name);
  if (!clip) return false;

  procedural = false;
  if (activeAction) activeAction.fadeOut(0.18);

  activeAction = mixer.clipAction(clip);
  activeAction.reset();
  activeAction.enabled = true;
  activeAction.setEffectiveWeight(1);
  activeAction.setEffectiveTimeScale(1);
  activeAction.setLoop(
    ["idle", "listen", "speak", "sleep"].includes(name)
      ? THREE.LoopRepeat
      : THREE.LoopOnce,
    Infinity
  );
  activeAction.clampWhenFinished = !["idle", "listen", "speak", "sleep"].includes(name);
  activeAction.fadeIn(0.18).play();
  return true;
}

function applyProceduralPose(name, t) {
  resetPose();
  const slow = Math.sin(t * 2.1);
  const beat = Math.sin(t * 5.8);
  const fast = Math.sin(t * 8.4);

  switch (name) {
    case "wave":
      rotate("upperArmR", -0.25, -0.28, -1.15);
      rotate("lowerArmR", -0.18, -0.16, -1.08 + fast * 0.34);
      rotate("wristR", 0, fast * 0.28, fast * 0.18);
      rotate("head", 0, -0.05, -0.055);
      offset("chest", 0, 0, -0.025);
      break;

    case "think":
      rotate("upperArmR", -0.15, -0.35, -0.85);
      rotate("lowerArmR", -0.18, -0.15, -1.22);
      rotate("wristR", 0.16, 0.05, -0.08);
      rotate("head", 0.04, -0.08, 0.13 + slow * 0.025);
      rotate("chest", 0, 0, -0.04);
      break;

    case "dance":
      rotate("chest", 0, beat * 0.09, beat * 0.12);
      rotate("upperChest", 0, -beat * 0.07, beat * 0.07);
      rotate("head", 0, -beat * 0.12, -beat * 0.08);
      rotate("upperArmR", -0.25, -0.2, -0.95 - slow * 0.4);
      rotate("lowerArmR", 0, 0, -0.5 + fast * 0.25);
      rotate("upperArmL", -0.25, 0.2, 0.95 + slow * 0.4);
      rotate("lowerArmL", 0, 0, 0.5 - fast * 0.25);
      rotate("thighR", beat * 0.18, 0, -0.08);
      rotate("thighL", -beat * 0.18, 0, 0.08);
      rotate("shinR", Math.max(0, -beat) * 0.22, 0, 0);
      rotate("shinL", Math.max(0, beat) * 0.22, 0, 0);
      break;

    case "celebrate":
      rotate("upperArmR", -0.32, -0.12, -1.5 + slow * 0.1);
      rotate("lowerArmR", 0, 0, -0.4 + fast * 0.13);
      rotate("upperArmL", -0.32, 0.12, 1.5 - slow * 0.1);
      rotate("lowerArmL", 0, 0, 0.4 - fast * 0.13);
      rotate("chest", 0, beat * 0.045, beat * 0.055);
      rotate("head", 0, 0, -beat * 0.045);
      break;

    case "sleep":
      rotate("head", 0.08, 0, 0.2 + slow * 0.012);
      rotate("neck", 0.03, 0, 0.08);
      rotate("chest", 0, 0, 0.055);
      rotate("upperArmR", 0, 0, -0.14);
      rotate("upperArmL", 0, 0, 0.14);
      break;

    case "listen":
      rotate("head", 0, 0.04, -0.105 + slow * 0.018);
      rotate("neck", 0, 0, -0.035);
      rotate("chest", 0, 0, slow * 0.012);
      break;

    case "speak":
      rotate("head", 0, fast * 0.012, fast * 0.013);
      rotate("chest", 0, 0, slow * 0.009);
      rotate("jaw", 0.04 + (fast + 1) * 0.025, 0, 0);
      break;

    case "idle":
    default:
      rotate("chest", 0, 0, slow * 0.009);
      rotate("upperChest", 0, 0, -slow * 0.005);
      rotate("head", 0, slow * 0.012, Math.sin(t * 0.72) * 0.012);
      break;
  }
}

function setState(name = "idle") {
  stateName = name;
  if (!modelReady) return;

  if (activeAction) {
    activeAction.stop();
    activeAction = null;
  }
  resetPose();
  procedural = !useNativeClip(name);
}

function render() {
  requestAnimationFrame(render);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (modelReady) {
    if (!procedural && mixer) {
      mixer.update(dt);
    } else {
      applyProceduralPose(stateName, elapsed);
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
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.frustumCulled = true;
        if (obj.material) {
          obj.material.side = THREE.FrontSide;
          obj.material.needsUpdate = true;
        }
      }
    });

    scene.add(model);
    normalizeModel(model);
    setupRig();

    mixer = new THREE.AnimationMixer(model);
    modelReady = true;

    if (loading) loading.classList.add("ready");
    shell.classList.add("is-ready");

    setState(stateName);
    window.dispatchEvent(new CustomEvent("mei3d-ready", {
      detail: {
        bones: Object.keys(rig),
        animations: (gltf.animations || []).map(a => a.name)
      }
    }));
  },
  progress => {
    if (!loading || !progress.total) return;
    const pct = Math.min(99, Math.round((progress.loaded / progress.total) * 100));
    loading.innerHTML = "<span></span> Cargando cuerpo 3D… " + pct + "%";
  },
  error => {
    console.error("Mei GLB load failed", error);
    if (loading) {
      loading.classList.add("error");
      loading.textContent = "No se pudo cargar el cuerpo 3D";
    }
    window.dispatchEvent(new CustomEvent("mei3d-error"));
  }
);

window.Mei3D = {
  setState,
  isReady: () => modelReady,
  getAnimations: () => model?.userData?.clips?.map(a => a.name) || []
};

window.addEventListener("resize", updateSize);
new ResizeObserver(updateSize).observe(shell);
updateSize();
render();
