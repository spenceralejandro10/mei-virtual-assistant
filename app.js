(() => {
  "use strict";

  const VERSION = "0.2.0-beta";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const store = {
    get(key, fallback) {
      try { const value = localStorage.getItem("mei:" + key); return value ? JSON.parse(value) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("mei:" + key, JSON.stringify(value)); } catch {}
    }
  };

  const state = {
    sound: store.get("sound", true),
    theme: store.get("theme", "dark"),
    interactions: store.get("interactions", 0),
    tasks: store.get("tasks", []),
    memories: store.get("memories", [
      { id: crypto.randomUUID ? crypto.randomUUID() : "m1", label: "IDENTIDAD", text: "Tu nombre es Spencer." },
      { id: crypto.randomUUID ? crypto.randomUUID() : "m2", label: "PROYECTO", text: "Mei nació como una asistente virtual web con cuerpo digital." }
    ]),
    listening: false,
    handsFree: false,
    recognition: null,
    speechTimer: null,
    animationTimer: null,
    speaking: false,
    currentState: "idle",
    profileName: store.get("profileName", "Spencer"),
    dragged: false,
    sketchfabApi: null,
    sketchfabReady: false,
    rigNodes: {},
    rigBaseMatrices: {},
    nativeAnimations: [],
    motionFrame: 0,
    motionToken: 0
  };

  const els = {
    body: document.body,
    stage: $("#stage"),
    character: $("#meiCharacter"),
    layer: $("#meiLayer"),
    mei3dCanvas: $("#mei3dCanvas"),
    mei3dLoading: $("#mei3dLoading"),
    bubble: $("#speechBubble"),
    bubbleText: $("#bubbleText"),
    bubbleClose: $("#bubbleClose"),
    quickRing: $("#quickRing"),
    commandInput: $("#commandInput"),
    sendButton: $("#sendButton"),
    micButton: $("#micButton"),
    quickMic: $("#quickMic"),
    soundToggle: $("#soundToggle"),
    themeToggle: $("#themeToggle"),
    statusText: $("#statusText"),
    meiStateText: $("#meiStateText"),
    clock: $("#clock"),
    taskForm: $("#taskForm"),
    taskInput: $("#taskInput"),
    taskList: $("#taskList"),
    memoryGrid: $("#memoryGrid"),
    taskCount: $("#taskCount"),
    memoryCount: $("#memoryCount"),
    interactionCount: $("#interactionCount"),
    toastStack: $("#toastStack")
  };

  const stateNames = {
    idle: "Observando",
    wave: "Saludando",
    think: "Pensando",
    dance: "Bailando",
    sleep: "Descansando",
    celebrate: "Celebrando",
    listen: "Escuchando",
    speak: "Hablando"
  };

  const MEI_3D_UID = "d549647cfae245679fe761babe4e3427";

  function sideMatch(name, side) {
    const n = String(name || "").toLowerCase();
    const right = /(?:right|(^|[._ -])r(?:$|[._ -]))/i.test(n);
    const left = /(?:left|(^|[._ -])l(?:$|[._ -]))/i.test(n);
    return side === "r" ? right : side === "l" ? left : true;
  }

  function nodeScore(node, spec) {
    const name = String(node?.name || "");
    if (!name || (spec.side && !sideMatch(name, spec.side))) return -1;
    if (spec.exclude?.some(rx => rx.test(name))) return -1;
    let score = 0;
    spec.include.forEach((rx, i) => { if (rx.test(name)) score += 30 - i * 3; });
    if (!score) return -1;
    if (/matrixtransform/i.test(String(node?.type || ""))) score += 8;
    return score;
  }

  function mapRigNodes(nodes) {
    const list = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
    const specs = {
      root: { include: [/^armature$/i, /^root$/i, /pelvis/i, /hips?/i] },
      chest: { include: [/spine0?3/i, /spine0?2/i, /chest/i, /torso/i, /upper.?body/i] },
      neck: { include: [/neck/i] },
      head: { include: [/(^|[._ -])head($|[._ -])/i], exclude: [/top/i, /end/i] },
      upperArmR: { side: "r", include: [/upper.?arm/i, /arm0?1/i, /shoulder/i], exclude: [/fore/i, /lower/i, /hand/i, /wrist/i] },
      foreArmR: { side: "r", include: [/fore.?arm/i, /lower.?arm/i, /arm0?2/i, /elbow/i], exclude: [/hand/i, /wrist/i] },
      handR: { side: "r", include: [/hand/i, /wrist/i] },
      upperArmL: { side: "l", include: [/upper.?arm/i, /arm0?1/i, /shoulder/i], exclude: [/fore/i, /lower/i, /hand/i, /wrist/i] },
      foreArmL: { side: "l", include: [/fore.?arm/i, /lower.?arm/i, /arm0?2/i, /elbow/i], exclude: [/hand/i, /wrist/i] },
      handL: { side: "l", include: [/hand/i, /wrist/i] },
      thighR: { side: "r", include: [/thigh/i, /upper.?leg/i, /leg0?1/i], exclude: [/lower/i, /calf/i, /shin/i, /foot/i] },
      shinR: { side: "r", include: [/lower.?leg/i, /calf/i, /shin/i, /leg0?2/i], exclude: [/foot/i] },
      thighL: { side: "l", include: [/thigh/i, /upper.?leg/i, /leg0?1/i], exclude: [/lower/i, /calf/i, /shin/i, /foot/i] },
      shinL: { side: "l", include: [/lower.?leg/i, /calf/i, /shin/i, /leg0?2/i], exclude: [/foot/i] }
    };

    state.rigNodes = {};
    Object.entries(specs).forEach(([role, spec]) => {
      let best = null, bestScore = -1;
      list.forEach(node => {
        const score = nodeScore(node, spec);
        if (score > bestScore) { best = node; bestScore = score; }
      });
      if (best) state.rigNodes[role] = best;
    });

    state.rigBaseMatrices = {};
    Object.entries(state.rigNodes).forEach(([role, node]) => {
      state.sketchfabApi.getMatrix(node.instanceID, (err, matrix) => {
        if (!err && matrix && matrix.length === 16) state.rigBaseMatrices[role] = Array.from(matrix);
      });
    });
  }

  function mat4Multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function rotationMatrix(axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    if (axis === "x") return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1];
    if (axis === "y") return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
    return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1];
  }

  function setJoint(role, angle, axis = "z") {
    const api = state.sketchfabApi;
    const node = state.rigNodes[role];
    const base = state.rigBaseMatrices[role];
    if (!api || !node || !base) return false;
    api.setMatrix(node.instanceID, mat4Multiply(base, rotationMatrix(axis, angle)), () => {});
    return true;
  }

  function restoreRigPose() {
    const api = state.sketchfabApi;
    if (!api) return;
    Object.entries(state.rigBaseMatrices).forEach(([role, matrix]) => {
      const node = state.rigNodes[role];
      if (node) api.setMatrix(node.instanceID, matrix, () => {});
    });
  }

  function tryNativeAnimation(name) {
    const api = state.sketchfabApi;
    if (!api || !state.nativeAnimations.length) return false;
    const patterns = {
      idle: /idle|breath|stand/i,
      wave: /wave|hello|greet/i,
      think: /think|ponder/i,
      dance: /dance/i,
      sleep: /sleep|rest/i,
      celebrate: /celebr|cheer|victory/i,
      listen: /listen|idle/i,
      speak: /talk|speak|idle/i
    };
    const match = state.nativeAnimations.find(a => patterns[name]?.test(String(a[1] || "")));
    if (!match) return false;
    api.setCurrentAnimationByUID(match[0], err => {
      if (!err) {
        api.setCycleMode(["idle","listen","speak","sleep"].includes(name) ? "loopOne" : "one", () => {});
        api.play(() => {});
      }
    });
    return true;
  }

  function applyProceduralPose(name, t) {
    const s = Math.sin(t * 3.2);
    const fast = Math.sin(t * 7.5);
    if (name === "idle") {
      setJoint("chest", 0.025 * s, "z");
      setJoint("head", 0.035 * Math.sin(t * 1.7), "y");
    } else if (name === "wave") {
      setJoint("upperArmR", -1.38 + 0.08 * s, "z");
      setJoint("foreArmR", -0.62 + 0.42 * fast, "z");
      setJoint("handR", 0.22 * fast, "y");
      setJoint("head", -0.06, "z");
    } else if (name === "think") {
      setJoint("upperArmR", -0.92, "z");
      setJoint("foreArmR", -1.10, "z");
      setJoint("head", 0.13 + 0.025 * s, "z");
      setJoint("chest", -0.04, "z");
    } else if (name === "dance") {
      setJoint("chest", 0.16 * fast, "z");
      setJoint("head", -0.10 * fast, "z");
      setJoint("upperArmR", -1.05 - 0.35 * s, "z");
      setJoint("upperArmL", 1.05 + 0.35 * s, "z");
      setJoint("foreArmR", -0.40 + 0.30 * fast, "z");
      setJoint("foreArmL", 0.40 - 0.30 * fast, "z");
      setJoint("thighR", 0.16 * fast, "x");
      setJoint("thighL", -0.16 * fast, "x");
      setJoint("shinR", -0.10 * fast, "x");
      setJoint("shinL", 0.10 * fast, "x");
    } else if (name === "celebrate") {
      setJoint("upperArmR", -1.75 + 0.10 * s, "z");
      setJoint("upperArmL", 1.75 - 0.10 * s, "z");
      setJoint("foreArmR", -0.28 * fast, "z");
      setJoint("foreArmL", 0.28 * fast, "z");
      setJoint("chest", 0.06 * fast, "z");
    } else if (name === "sleep") {
      setJoint("head", 0.25 + 0.025 * s, "z");
      setJoint("chest", 0.10, "z");
      setJoint("upperArmR", -0.16, "z");
      setJoint("upperArmL", 0.16, "z");
    } else if (name === "listen") {
      setJoint("head", -0.11 + 0.02 * s, "z");
      setJoint("chest", 0.025 * s, "z");
    } else if (name === "speak") {
      setJoint("head", 0.025 * fast, "y");
      setJoint("chest", 0.018 * s, "z");
    }
  }

  function play3DMotion(name) {
    if (window.Mei3D && typeof window.Mei3D.setState === "function") {
      window.Mei3D.setState(name);
    }
  }

  function initMei3D() {
    let announced = false;

    const onReady = () => {
      state.sketchfabReady = true;
      if (els.mei3dLoading) els.mei3dLoading.classList.add("ready");
      play3DMotion(state.currentState || "idle");

      if (!announced) {
        announced = true;
        toast("Cuerpo 3D local de Mei conectado");
        setTimeout(() => {
          if (state.currentState === "idle") {
            setState("wave", 2200);
            showBubble("Ya estoy usando mi cuerpo 3D local, sin el bloqueo de contenido.", { speak: false, duration: 4200 });
          }
        }, 650);
      }
    };

    const onError = () => {
      state.sketchfabReady = false;
      if (els.mei3dLoading) {
        els.mei3dLoading.classList.add("error");
        els.mei3dLoading.textContent = "El cuerpo 3D no pudo cargarse";
      }
      toast("No se pudo cargar el cuerpo 3D local");
    };

    window.addEventListener("mei3d-ready", onReady, { once: true });
    window.addEventListener("mei3d-error", onError, { once: true });

    if (window.Mei3D && typeof window.Mei3D.isReady === "function" && window.Mei3D.isReady()) {
      onReady();
    }
  }

  function saveAll() {
    store.set("sound", state.sound);
    store.set("theme", state.theme);
    store.set("interactions", state.interactions);
    store.set("tasks", state.tasks);
    store.set("memories", state.memories);
    store.set("profileName", state.profileName);
  }

  function updateStats() {
    els.interactionCount.textContent = state.interactions;
    els.taskCount.textContent = state.tasks.filter(t => !t.done).length;
    els.memoryCount.textContent = state.memories.length;
  }

  function setState(next, duration = 0) {
    clearTimeout(state.animationTimer);
    state.currentState = next;
    els.character.className = "mei-character state-" + next;
    els.meiStateText.textContent = stateNames[next] || next;
    els.statusText.textContent = next === "sleep" ? "Mei descansando" : next === "listen" ? "Mei escuchando" : "Mei disponible";
    play3DMotion(next);
    if (duration) state.animationTimer = setTimeout(() => setState("idle"), duration);
  }

  function showBubble(message, options = {}) {
    const duration = options.duration || Math.min(9000, Math.max(3600, message.length * 48));
    els.bubbleText.textContent = message;
    els.bubble.classList.add("show");
    clearTimeout(state.speechTimer);
    state.speechTimer = setTimeout(() => els.bubble.classList.remove("show"), duration);
    if (options.speak !== false) speak(message);
  }

  function setSpeaking(active) {
    state.speaking = Boolean(active);
    if (window.Mei3D && typeof window.Mei3D.setSpeaking === "function") {
      window.Mei3D.setSpeaking(state.speaking);
    }
  }

  function speak(message) {
    if (!state.sound || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /^es-CO/i.test(v.lang)) ||
      voices.find(v => /^es-/i.test(v.lang) && /sabina|monica|paulina|helena|female/i.test(v.name)) ||
      voices.find(v => /^es-/i.test(v.lang));
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred ? preferred.lang : "es-CO";
    utterance.rate = 1.03;
    utterance.pitch = 1.08;

    utterance.onstart = () => {
      setSpeaking(true);
      if (state.currentState === "idle") {
        state.currentState = "speak";
        els.character.className = "mei-character state-speak";
        els.meiStateText.textContent = stateNames.speak;
        els.statusText.textContent = "Mei hablando";
        play3DMotion("speak");
      } else {
        els.meiStateText.textContent = stateNames.speak;
        els.statusText.textContent = "Mei hablando";
      }
    };

    const finishSpeech = () => {
      setSpeaking(false);
      if (state.currentState === "speak") {
        setState("idle");
      } else {
        els.meiStateText.textContent = stateNames[state.currentState] || state.currentState;
        els.statusText.textContent = state.currentState === "sleep" ? "Mei descansando" : state.currentState === "listen" ? "Mei escuchando" : "Mei disponible";
      }
    };

    utterance.onend = finishSpeech;
    utterance.onerror = finishSpeech;
    window.speechSynthesis.speak(utterance);
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    els.toastStack.append(node);
    setTimeout(() => node.remove(), 3000);
  }

  function normalize(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  function addTask(text) {
    const clean = text.trim().replace(/[.!]+$/, "");
    if (!clean) return;
    state.tasks.unshift({ id: Date.now().toString(36), text: clean, done: false, createdAt: Date.now() });
    saveAll(); renderTasks(); updateStats();
  }

  function addMemory(text, label = "RECUERDO") {
    const clean = text.trim().replace(/[.!]+$/, "");
    if (!clean) return;
    state.memories.unshift({ id: Date.now().toString(36), label, text: clean });
    saveAll(); renderMemories(); updateStats();
  }

  function renderTasks() {
    els.taskList.innerHTML = "";
    if (!state.tasks.length) {
      els.taskList.innerHTML = '<div class="empty">No hay misiones pendientes.<br>Dile a Mei que recuerde algo.</div>';
      return;
    }
    state.tasks.forEach(task => {
      const item = document.createElement("div");
      item.className = "task-item" + (task.done ? " done" : "");
      item.innerHTML = '<button class="task-check" aria-label="Completar"></button><div class="task-copy"></div><button class="task-delete" aria-label="Eliminar">×</button>';
      $(".task-copy", item).textContent = task.text;
      $(".task-check", item).onclick = () => {
        task.done = !task.done; saveAll(); renderTasks(); updateStats();
        if (task.done) { setState("celebrate", 2200); showBubble("Misión completada. Bien hecho.", { speak: false }); }
      };
      $(".task-delete", item).onclick = () => { state.tasks = state.tasks.filter(t => t.id !== task.id); saveAll(); renderTasks(); updateStats(); };
      els.taskList.append(item);
    });
  }

  function renderMemories() {
    els.memoryGrid.innerHTML = "";
    if (!state.memories.length) {
      els.memoryGrid.innerHTML = '<div class="empty">Mi memoria local está vacía.</div>';
      return;
    }
    state.memories.forEach(memory => {
      const card = document.createElement("article");
      card.className = "memory-card";
      card.innerHTML = '<small></small><p></p><button>Olvidar</button>';
      $("small", card).textContent = memory.label;
      $("p", card).textContent = memory.text;
      $("button", card).onclick = () => {
        state.memories = state.memories.filter(m => m.id !== memory.id);
        saveAll(); renderMemories(); updateStats();
      };
      els.memoryGrid.append(card);
    });
  }

  function switchScene(name) {
    $$(".scene").forEach(s => s.classList.toggle("active", s.dataset.scenePanel === name));
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.scene === name));
    if (name === "missions") wanderTo(72);
    else if (name === "memory") wanderTo(68);
    else if (name === "lab") wanderTo(76);
    else wanderTo(78);
  }

  function wanderTo(percent) {
    if (window.innerWidth < 720 || state.dragged) return;
    const stageWidth = els.stage.clientWidth;
    const layerWidth = els.layer.offsetWidth;
    const target = Math.max(12, Math.min(stageWidth - layerWidth - 12, stageWidth * (percent / 100) - layerWidth / 2));
    els.layer.style.right = "auto";
    els.layer.style.left = target + "px";
  }

  function action(name) {
    const actions = {
      wave: ["wave", "¡Hola! Aquí estoy.", 2400],
      think: ["think", "Déjame pensar un momento…", 3000],
      dance: ["dance", "Un poco de movimiento también cuenta como productividad.", 4200],
      sleep: ["sleep", "Voy a descansar aquí. Tócame cuando me necesites.", 6500],
      celebrate: ["celebrate", "¡Eso merece celebrarse!", 2800]
    };
    const a = actions[name];
    if (!a) return;
    setState(a[0], a[2]);
    showBubble(a[1], { speak: name !== "sleep" });
  }

  function timeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  }

  function capabilitiesText() {
    return "Puedo escucharte, hablar, guardar recuerdos y misiones, cambiar de sección, abrir algunos recursos web, reaccionar con mi cuerpo 3D y reconocer órdenes simples. Mi cuerpo actual usa un modelo 3D riggeado y puede ejecutar movimientos desde la interfaz.";
  }

  function processCommand(raw, source = "text") {
    const text = raw.trim();
    if (!text) return;
    state.interactions += 1;
    saveAll(); updateStats();
    els.commandInput.value = "";
    let q = normalize(text).replace(/^mei[\s,.:;-]*/i, "").trim();
    if (!q && normalize(text).startsWith("mei")) {
      setState("listen", 2600);
      showBubble("Sí, " + state.profileName + ". Aquí estoy. ¿Qué necesitas?");
      return;
    }

    setState("think");
    setTimeout(() => {
      let response = "";
      let anim = "idle";

      if (/presentate|quien eres|como te llamas/.test(q)) {
        anim = "wave";
        response = "Soy Mei. No soy solo una caja de chat: tengo un cuerpo digital, voz, memoria local y pequeñas acciones. Esta es mi primera beta.";
      } else if (/que puedes hacer|capacidades|funciones|ayuda/.test(q)) {
        response = capabilitiesText();
      } else if (/que hora|hora es|dime la hora/.test(q)) {
        response = "Son las " + new Intl.DateTimeFormat("es-CO",{hour:"numeric",minute:"2-digit"}).format(new Date()) + ".";
      } else if (/que fecha|que dia|fecha es/.test(q)) {
        response = "Hoy es " + new Intl.DateTimeFormat("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date()) + ".";
      } else if (/baila|bailar|danza/.test(q)) {
        action("dance"); return;
      } else if (/saluda|saludame|di hola/.test(q)) {
        action("wave"); return;
      } else if (/duerme|descansa/.test(q)) {
        action("sleep"); return;
      } else if (/piensa|pensar/.test(q)) {
        action("think"); return;
      } else if (/celebra|celebrar/.test(q)) {
        action("celebrate"); return;
      } else if (/recu[eé]rdame|recordarme/.test(text.toLowerCase())) {
        const task = text.replace(/^.*?recu[eé]rdame\s*(que\s*)?/i, "").trim();
        if (task) {
          addTask(task);
          anim = "celebrate";
          response = "Listo. Lo guardé como misión: " + task + ".";
        } else response = "Dime qué quieres que recuerde.";
      } else if (/recuerda que|memoriza/.test(text.toLowerCase())) {
        const memory = text.replace(/^.*?(recuerda que|memoriza)\s*/i, "").trim();
        if (memory) {
          addMemory(memory);
          response = "Lo guardé en mi memoria local.";
        } else response = "Dime qué quieres que recuerde.";
      } else if (/me llamo\s+/.test(q)) {
        const match = text.match(/me llamo\s+([^,.!]+)/i);
        if (match) {
          state.profileName = match[1].trim();
          addMemory("Tu nombre es " + state.profileName + ".", "IDENTIDAD");
          saveAll();
          anim = "wave";
          response = "Encantada, " + state.profileName + ". Lo recordaré en este navegador.";
        }
      } else if (/misiones|tareas|pendientes/.test(q) && /(abre|muestra|ver|ir|vamos)/.test(q)) {
        switchScene("missions");
        response = "Aquí están tus misiones.";
      } else if (/memoria|recuerdos/.test(q) && /(abre|muestra|ver|ir|vamos)/.test(q)) {
        switchScene("memory");
        response = "Esta es mi memoria local.";
      } else if (/laboratorio|animaciones/.test(q) && /(abre|muestra|ver|ir|vamos)/.test(q)) {
        switchScene("lab");
        response = "Bienvenido a mi laboratorio.";
      } else if (/inicio|casa|home/.test(q) && /(abre|muestra|ir|vamos|volver)/.test(q)) {
        switchScene("home");
        response = "Volvemos al inicio.";
      } else if (/abre github|ir a github/.test(q)) {
        window.open("https://github.com/spenceralejandro10/mei-virtual-assistant", "_blank", "noopener");
        response = "Abrí nuestro repositorio de Mei en otra pestaña.";
      } else if (/abre cardnest|ir a cardnest/.test(q)) {
        window.open("https://spenceralejandro10.github.io/pokemon-card-inventory/", "_blank", "noopener");
        response = "Abrí CardNest en otra pestaña.";
      } else if (/modo claro|tema claro/.test(q)) {
        applyTheme("light"); response = "Modo claro activado.";
      } else if (/modo oscuro|tema oscuro/.test(q)) {
        applyTheme("dark"); response = "Modo oscuro activado.";
      } else if (/silencio|no hables|apaga.*voz/.test(q)) {
        state.sound = false; saveAll(); syncSoundButton(); response = "Entendido. Seguiré respondiendo por texto."; 
      } else if (/activa.*voz|habla|sonido/.test(q)) {
        state.sound = true; saveAll(); syncSoundButton(); response = "Voz activada. Ya puedo hablar contigo.";
      } else if (/hola|buenos dias|buenas tardes|buenas noches|hey/.test(q)) {
        anim = "wave"; response = timeGreeting() + ", " + state.profileName + ". Estoy contigo. ¿Qué hacemos?";
      } else if (/como estas|como te sientes/.test(q)) {
        response = "Activa y curiosa. Mi cuerpo digital está funcionando y todavía tengo mucho por aprender.";
      } else if (/gracias/.test(q)) {
        anim = "celebrate"; response = "Con gusto. Seguimos cuando quieras.";
      } else if (/version|que version/.test(q)) {
        response = "Estoy ejecutando Mei versión " + VERSION + ".";
      } else {
        response = "Entendí: “" + text + "”. En esta beta todavía no tengo conectado un modelo conversacional general, pero mi sistema de acciones ya está listo para recibirlo. Prueba una orden como “recuérdame…”, “abre GitHub”, “baila” o “¿qué puedes hacer?”.";
      }

      setState(anim, anim === "idle" ? 0 : 2600);
      showBubble(response);
    }, source === "voice" ? 380 : 240);
  }

  function syncSoundButton() {
    els.soundToggle.textContent = state.sound ? "🔊" : "🔇";
    els.soundToggle.title = state.sound ? "Desactivar voz" : "Activar voz";
  }

  function applyTheme(theme) {
    state.theme = theme;
    els.body.classList.toggle("light", theme === "light");
    saveAll();
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  }

  function configureRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      els.micButton.title = "El reconocimiento de voz no está disponible en este navegador";
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "es-CO";
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = "";

    rec.onstart = () => {
      state.listening = true;
      finalText = "";
      els.micButton.classList.add("listening");
      $(".command-input").classList.add("listening");
      setState("listen");
      toast("Mei está escuchando");
    };

    rec.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      els.commandInput.value = (finalText + interim).trim();
      if (finalText.trim()) {
        const heard = finalText.trim();
        const n = normalize(heard);
        if (n.includes("mei")) {
          rec.stop();
          state.handsFree = false;
          processCommand(heard, "voice");
          finalText = "";
        }
      }
    };

    rec.onerror = event => {
      if (event.error !== "no-speech" && event.error !== "aborted") toast("Micrófono: " + event.error);
    };

    rec.onend = () => {
      state.listening = false;
      els.micButton.classList.remove("listening");
      $(".command-input").classList.remove("listening");
      if (state.currentState === "listen") setState("idle");
      if (state.handsFree) {
        setTimeout(() => { try { rec.start(); } catch {} }, 300);
      }
    };

    state.recognition = rec;
  }

  function toggleListening() {
    if (!state.recognition) {
      toast("Tu navegador no ofrece reconocimiento de voz. Chrome/Edge suelen soportarlo.");
      showBubble("No puedo usar el micrófono en este navegador, pero puedes escribirme aquí.", { speak: false });
      return;
    }
    if (state.listening) {
      state.handsFree = false;
      state.recognition.stop();
    } else {
      state.handsFree = true;
      try { state.recognition.start(); } catch {}
    }
  }

  function updateClock() {
    els.clock.textContent = new Intl.DateTimeFormat("es-CO",{hour:"2-digit",minute:"2-digit"}).format(new Date());
  }

  function setupDrag() {
    let startX = 0, originLeft = 0, moving = false;
    els.character.addEventListener("pointerdown", e => {
      if (window.innerWidth < 720) return;
      moving = false;
      startX = e.clientX;
      const rect = els.layer.getBoundingClientRect();
      originLeft = rect.left - els.stage.getBoundingClientRect().left;
      els.character.setPointerCapture(e.pointerId);
    });
    els.character.addEventListener("pointermove", e => {
      if (!els.character.hasPointerCapture(e.pointerId) || window.innerWidth < 720) return;
      const delta = e.clientX - startX;
      if (Math.abs(delta) > 5) moving = true;
      if (!moving) return;
      const max = els.stage.clientWidth - els.layer.offsetWidth;
      const left = Math.max(0, Math.min(max, originLeft + delta));
      els.layer.style.right = "auto";
      els.layer.style.left = left + "px";
      state.dragged = true;
    });
    els.character.addEventListener("pointerup", e => {
      if (els.character.hasPointerCapture(e.pointerId)) els.character.releasePointerCapture(e.pointerId);
      if (!moving) toggleQuickRing();
    });
  }

  function setupLookTracking() {
    const irises = $$(".iris");
    document.addEventListener("pointermove", e => {
      if (!irises.length || state.currentState === "sleep") return;
      const rect = els.character.getBoundingClientRect();
      const cx = rect.left + rect.width * .5;
      const cy = rect.top + rect.height * .32;
      const dx = Math.max(-3, Math.min(3, (e.clientX - cx) / 130));
      const dy = Math.max(-2, Math.min(2, (e.clientY - cy) / 150));
      irises[0].setAttribute("cx", 121 + dx); irises[0].setAttribute("cy", 137 + dy);
      irises[1].setAttribute("cx", 179 + dx); irises[1].setAttribute("cy", 137 + dy);
    });
  }

  function toggleQuickRing(force) {
    const shouldShow = typeof force === "boolean" ? force : !els.quickRing.classList.contains("show");
    els.quickRing.classList.toggle("show", shouldShow);
    if (shouldShow && state.currentState === "sleep") setState("idle");
  }

  function proactiveLoop() {
    const messages = [
      "Sigo aquí. Si necesitas algo, solo di “Mei”.",
      "Puedo guardar una misión mientras trabajas.",
      "¿Quieres probar una de mis animaciones?",
      "Todavía estoy aprendiendo, pero ya tengo cuerpo, voz y memoria."
    ];
    const tick = () => {
      if (!document.hidden && state.currentState === "idle" && !els.bubble.classList.contains("show")) {
        const msg = messages[Math.floor(Math.random() * messages.length)];
        showBubble(msg, { speak: false, duration: 4200 });
        if (Math.random() > .55 && !state.dragged) wanderTo(58 + Math.random() * 32);
      }
      setTimeout(tick, 42000 + Math.random() * 28000);
    };
    setTimeout(tick, 30000);
  }

  function bindEvents() {
    els.sendButton.onclick = () => processCommand(els.commandInput.value);
    els.commandInput.addEventListener("keydown", e => { if (e.key === "Enter") processCommand(els.commandInput.value); });
    els.micButton.onclick = toggleListening;
    if (els.quickMic) els.quickMic.onclick = e => { e.stopPropagation(); toggleListening(); };
    els.soundToggle.onclick = () => { state.sound = !state.sound; saveAll(); syncSoundButton(); toast(state.sound ? "Voz activada" : "Voz desactivada"); };
    els.themeToggle.onclick = toggleTheme;
    els.bubbleClose.onclick = () => els.bubble.classList.remove("show");

    $$(".nav-btn").forEach(btn => btn.onclick = () => switchScene(btn.dataset.scene));
    $$("[data-command]").forEach(btn => btn.onclick = e => { e.stopPropagation(); processCommand(btn.dataset.command); });
    $$("[data-action]").forEach(btn => btn.onclick = e => { e.stopPropagation(); action(btn.dataset.action); });
    $("#voiceTest").onclick = () => { state.sound = true; saveAll(); syncSoundButton(); setState("wave", 2200); showBubble("Esta es mi voz del navegador. Más adelante podremos conectarme una voz propia."); };

    els.taskForm.addEventListener("submit", e => {
      e.preventDefault();
      const value = els.taskInput.value.trim();
      if (!value) return;
      addTask(value); els.taskInput.value = "";
      setState("celebrate", 2200); showBubble("Misión guardada.", { speak: false });
    });

    els.character.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleQuickRing(); }
    });
    els.character.addEventListener("dblclick", () => action("wave"));
    document.addEventListener("pointerdown", e => {
      if (!els.layer.contains(e.target) && !e.target.closest("[data-command]")) toggleQuickRing(false);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.listening && state.recognition) { state.handsFree = false; try { state.recognition.stop(); } catch {} }
    });
  }

  function boot() {
    applyTheme(state.theme);
    syncSoundButton();
    renderTasks();
    renderMemories();
    updateStats();
    updateClock();
    setInterval(updateClock, 1000);
    configureRecognition();
    initMei3D();
    setupDrag();
    setupLookTracking();
    bindEvents();
    proactiveLoop();
    setTimeout(() => {
      setState("wave", 2500);
      showBubble(timeGreeting() + ", " + state.profileName + ". Soy Mei. Tócame, escríbeme o activa el micrófono. Esta vez sí tengo cuerpo 3D.", { speak: false, duration: 7200 });
    }, 650);

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  boot();
})();