import * as THREE from "./vendor/three.module.js";

const FIELD_W = 16;
const FIELD_D = 24;
const SHIP_SPEED = 10;
const BULLET_SPEED = 21.3;
const FIRE_COOLDOWN = 0.14;
const HITS_PER_LIFE = 3;

const TIERS = [
  { r: 1.15, speed: 1.95, score: 20, edge: "#d5cdc0" },
  { r: 0.68, speed: 3.15, score: 50, edge: "#e4dcd0" },
  { r: 0.42, speed: 4.55, score: 100, edge: "#f3ece3" },
];

const stage = document.getElementById("stage");
const canvas = document.getElementById("game");
const hud = document.getElementById("hud");
const hudScore = document.getElementById("hud-score");
const hudLives = document.getElementById("hud-lives");
const healthMeter = document.getElementById("health");
const healthFill = document.getElementById("health-fill");
const healthLabel = document.getElementById("health-label");
const hudHelp = document.getElementById("hud-help");
const flash = document.getElementById("flash");
const held = new Set();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070910);
scene.fog = new THREE.Fog(0x070910, 18, 46);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace || "srgb";
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

scene.add(new THREE.HemisphereLight(0xb7c9ea, 0x1a140f, 0.55));
const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.7);
keyLight.position.set(6, 14, 8);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9eb4d4, 0.45);
fillLight.position.set(-8, 6, -6);
scene.add(fillLight);

const deck = new THREE.Mesh(
  new THREE.PlaneGeometry(FIELD_W + 6, 56),
  new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 1, metalness: 0 })
);
deck.rotation.x = -Math.PI / 2;
deck.position.set(0, -1.45, -4);
scene.add(deck);

const lane = makeLane();
scene.add(lane);

const bulletGeo = new THREE.CapsuleGeometry(0.055, 0.42, 2, 6);
bulletGeo.rotateX(Math.PI / 2);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
const debrisGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
const BONUS_R = 0.28;
const SHIELD_TIME = 7;
const CANNON_TIME = 15;
const bonusGeo = new THREE.SphereGeometry(BONUS_R, 18, 14);
const bonusMat = new THREE.MeshStandardMaterial({
  color: 0x3dff7a,
  emissive: 0x1fbf55,
  emissiveIntensity: 1.35,
  roughness: 0.32,
  metalness: 0.04,
});
const sideBulletGeo = new THREE.CapsuleGeometry(0.034, 0.24, 2, 5);
sideBulletGeo.rotateX(Math.PI / 2);
const sideBulletMat = new THREE.MeshBasicMaterial({ color: 0xb7e6ff, toneMapped: false });
const CANNON_X = 0.44;
const ROCK_DROP_CHANCE = 0.2;
const cannonBarrelGeo = new THREE.CylinderGeometry(0.042, 0.058, 0.34, 8);
cannonBarrelGeo.rotateX(-Math.PI / 2);
const cannonPodGeo = new THREE.SphereGeometry(0.072, 10, 8);
const cannonMat = new THREE.MeshStandardMaterial({
  color: 0xd7e4f2,
  roughness: 0.28,
  metalness: 0.64,
  emissive: 0x1c4e72,
  emissiveIntensity: 0.7,
});
const pickupGeo = new THREE.OctahedronGeometry(0.24, 0);
const cannonPickupMat = new THREE.MeshStandardMaterial({
  color: 0x8fd4ff,
  emissive: 0x2f8fd6,
  emissiveIntensity: 1.4,
  roughness: 0.25,
  metalness: 0.15,
});

const BONUS_DEFS = {
  shield: {
    family: "effect",
    fromRock: false,
    geometry: bonusGeo,
    material: bonusMat,
    burst: "#5dff8a",
    apply(player) {
      player.shield = SHIELD_TIME;
    },
  },
  cannons: {
    family: "weapon",
    fromRock: true,
    geometry: pickupGeo,
    material: cannonPickupMat,
    burst: "#8fd4ff",
    duration: CANNON_TIME,
    lostOnHit: true,
    owned(player) {
      return player.weapons.has("cannons");
    },
    apply(player) {
      player.weapons.add("cannons");
      player.weaponTime.cannons = CANNON_TIME;
    },
  },
};

const ship = buildShip();
scene.add(ship);
const engineLight = new THREE.PointLight(0x7fd4ff, 3, 7, 2);
ship.add(engineLight);
const shieldMat = new THREE.MeshBasicMaterial({
  color: 0x5dff8a,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const shieldRingMat = new THREE.MeshBasicMaterial({
  color: 0xd8ffe8,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1.15, 28, 20), shieldMat);
const shieldRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.22, 48), shieldRingMat);
shieldRing.rotation.x = -Math.PI / 2;
shieldRing.position.y = 0.06;
shieldMesh.add(shieldRing);
shieldMesh.visible = false;
shieldMesh.renderOrder = 2;
scene.add(shieldMesh);

let starPositions = null;

const state = {
  player: null,
  bullets: [],
  rocks: [],
  bonuses: [],
  particles: [],
  stars: [],
  score: 0,
  lives: 3,
  health: HITS_PER_LIFE,
  over: false,
  mode: "menu",
  time: 0,
  spawnAcc: 0,
  bonusAcc: 0,
  bonusEvery: 6,
  shake: 0,
  flash: 0,
};

function makeLane() {
  const half = FIELD_W / 2;
  const positions = [];
  for (let i = 0; i <= 12; i++) {
    const x = -half + (FIELD_W / 12) * i;
    positions.push(x, 0, -28, x, 0, 16);
  }
  for (let z = -28; z <= 16; z += 2) {
    positions.push(-half, 0, z, half, 0, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x31445f, transparent: true, opacity: 0.45 })
  );
  lines.position.y = -1.4;
  return lines;
}

function buildShip() {
  const group = new THREE.Group();
  const bodyGeo = new THREE.ConeGeometry(0.38, 1.08, 3);
  bodyGeo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({
      color: 0xf7f4ec,
      roughness: 0.38,
      metalness: 0.18,
      emissive: 0x163646,
      emissiveIntensity: 0.45,
    })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(bodyGeo),
    new THREE.LineBasicMaterial({ color: 0x7fd4ff })
  );
  const flameGeo = new THREE.ConeGeometry(0.11, 0.42, 6);
  flameGeo.rotateX(Math.PI / 2);
  const flame = new THREE.Mesh(
    flameGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffb15a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  flame.position.z = 0.62;
  flame.name = "flame";
  group.add(body, edges, flame, makeSideCannon(-1), makeSideCannon(1));
  return group;
}

function makeSideCannon(side) {
  const group = new THREE.Group();
  group.name = side < 0 ? "cannon-port" : "cannon-starboard";
  const barrel = new THREE.Mesh(cannonBarrelGeo, cannonMat);
  const pod = new THREE.Mesh(cannonPodGeo, cannonMat);
  pod.position.z = 0.12;
  group.add(pod, barrel);
  group.position.set(side * CANNON_X, 0.03, 0.06);
  group.visible = false;
  return group;
}

function resize() {
  const width = stage.clientWidth || 480;
  const height = stage.clientHeight || 720;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function makeStars() {
  const count = 260;
  starPositions = new Float32Array(count * 3);
  state.stars = [];
  for (let i = 0; i < count; i++) {
    const star = {
      x: (Math.random() - 0.5) * FIELD_W * 1.6,
      y: 0.4 + Math.random() * 9,
      z: (Math.random() - 0.5) * FIELD_D * 2.2,
      depth: Math.random(),
    };
    state.stars.push(star);
    starPositions[i * 3] = star.x;
    starPositions[i * 3 + 1] = star.y;
    starPositions[i * 3 + 2] = star.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xd7e4f8, size: 0.055, sizeAttenuation: true })
  ));
}

function releaseObject(object, sharedGeometry, sharedMaterial) {
  object.removeFromParent();
  for (const child of [...object.children]) {
    releaseObject(child, !!child.userData.sharedGeometry, !!child.userData.sharedMaterial);
  }
  const material = object.material;
  if (material && !sharedMaterial) {
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) {
      if (entry.map) entry.map.dispose();
      entry.dispose();
    }
  }
  if (object.geometry && !sharedGeometry) object.geometry.dispose();
}

function dropMesh(actor) {
  if (!actor.mesh) return;
  releaseObject(actor.mesh, !!actor.sharedGeometry, !!actor.sharedMaterial);
  actor.mesh = null;
}

function discard(list) {
  for (const item of list) dropMesh(item);
}

function reset() {
  discard(state.rocks);
  discard(state.bullets);
  discard(state.bonuses);
  discard(state.particles);
  state.player = {
    x: 0,
    z: FIELD_D * 0.34,
    r: 0.43,
    cool: 0,
    invuln: 1.2,
    shield: 0,
    weapons: new Set(),
    weaponTime: {},
    bank: 0,
    pitch: 0,
  };
  state.bullets = [];
  state.rocks = [];
  state.bonuses = [];
  state.particles = [];
  state.score = 0;
  state.lives = 3;
  state.health = HITS_PER_LIFE;
  state.over = false;
  state.mode = "play";
  state.time = 0;
  state.spawnAcc = 0.45;
  state.bonusAcc = 0;
  state.bonusEvery = 14 + Math.random() * 8;
  state.shake = 0;
  state.flash = 0;
}

function rockRgb(channels, alpha) {
  const body = channels[0] + "," + channels[1] + "," + channels[2];
  return alpha == null ? "rgb(" + body + ")" : "rgba(" + body + "," + alpha + ")";
}

function makeRockTexture() {
  const size = 128;
  const palettes = [
    [118, 108, 96],
    [136, 116, 96],
    [102, 108, 116],
    [128, 104, 84],
  ];
  const base = palettes[Math.floor(Math.random() * palettes.length)];
  const tex = document.createElement("canvas");
  tex.width = size;
  tex.height = size;
  const g = tex.getContext("2d", { willReadFrequently: true });

  function tone(amount) {
    return [
      Math.max(0, Math.min(255, base[0] + amount)),
      Math.max(0, Math.min(255, base[1] + amount)),
      Math.max(0, Math.min(255, base[2] + amount * 0.85)),
    ];
  }

  g.fillStyle = rockRgb(tone(0));
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 7; i++) {
    const blob = tone((Math.random() - 0.45) * 58);
    g.fillStyle = rockRgb(blob, 0.7);
    g.beginPath();
    g.ellipse(
      Math.random() * size,
      Math.random() * size,
      12 + Math.random() * 26,
      8 + Math.random() * 20,
      Math.random() * Math.PI,
      0,
      Math.PI * 2
    );
    g.fill();
  }

  const pits = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pits; i++) {
    const rad = 6 + Math.random() * 12;
    const x = 26 + Math.random() * (size - 52);
    const y = 26 + Math.random() * (size - 52);
    g.fillStyle = rockRgb(tone(-58 - Math.random() * 24), 0.9);
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.8 + Math.random() * 0.22), Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rockRgb(tone(52), 0.75);
    g.lineWidth = 1.7;
    g.beginPath();
    g.arc(x, y, rad * 0.92, Math.PI, Math.PI * 1.55);
    g.stroke();
  }

  g.lineCap = "round";
  g.lineJoin = "round";
  const cracks = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < cracks; i++) {
    let x = 28 + Math.random() * (size - 56);
    let y = 28 + Math.random() * (size - 56);
    g.strokeStyle = rockRgb(tone(-70), 0.6);
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(x, y);
    for (let step = 0; step < 4; step++) {
      x += (Math.random() - 0.5) * 38;
      y += (Math.random() - 0.5) * 38;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  for (let i = 0; i < 18; i++) {
    g.fillStyle = rockRgb(tone(36 + Math.random() * 46), 0.85);
    const chip = 1.2 + Math.random() * 2.2;
    g.fillRect(Math.random() * size, Math.random() * size, chip, chip);
  }

  const pixels = g.getImageData(0, 0, size, size);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 24;
    data[i] = Math.max(0, Math.min(255, data[i] + grain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain * 0.92));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain * 0.78));
  }
  g.putImageData(pixels, 0, 0);

  const light = g.createLinearGradient(0, 0, size, size);
  light.addColorStop(0, "rgba(255, 246, 232, 0.22)");
  light.addColorStop(0.48, "rgba(255, 255, 255, 0)");
  light.addColorStop(1, "rgba(18, 12, 8, 0.34)");
  g.fillStyle = light;
  g.fillRect(0, 0, size, size);

  return tex;
}

function makeRockMesh(radius) {
  const geometry = new THREE.IcosahedronGeometry(radius, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
    vertex.multiplyScalar(0.78 + Math.random() * 0.28);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  const texture = new THREE.CanvasTexture(makeRockTexture());
  texture.colorSpace = THREE.SRGBColorSpace || "srgb";
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
}

function spawnRock(x, z, tier, vx, vz, drop = null) {
  const spec = TIERS[tier];
  const rock = {
    x,
    z,
    r: spec.r,
    tier,
    vx,
    vz: Math.max(1.05, vz),
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 1.6,
    tumble: Math.random() * Math.PI * 2,
    drop,
    marker: null,
    alive: true,
    mesh: makeRockMesh(spec.r),
  };
  if (drop) attachDropMarker(rock);
  state.rocks.push(rock);
  return rock;
}

function attachDropMarker(rock) {
  const def = BONUS_DEFS[rock.drop];
  const marker = new THREE.Mesh(def.geometry, def.material);
  marker.scale.setScalar(0.72);
  marker.position.y = rock.r * 0.92;
  marker.userData.sharedGeometry = true;
  marker.userData.sharedMaterial = true;
  rock.mesh.add(marker);
  rock.marker = marker;
}

function rollRockDrop() {
  const kinds = Object.keys(BONUS_DEFS).filter((kind) => {
    const def = BONUS_DEFS[kind];
    return def.fromRock && !(def.owned && def.owned(state.player));
  });
  if (!kinds.length || Math.random() > ROCK_DROP_CHANCE) return null;
  return kinds[Math.floor(Math.random() * kinds.length)];
}

function pickTier() {
  const roll = Math.random();
  if (state.time > 28 && roll < 0.12) return 2;
  if (state.time > 12 && roll < 0.42) return 1;
  return 0;
}

function spawnPickup(kind, x, z, vx, vz) {
  const def = BONUS_DEFS[kind];
  const mesh = new THREE.Mesh(def.geometry, def.material);
  scene.add(mesh);
  state.bonuses.push({
    category: "bonus",
    kind,
    family: def.family,
    x,
    z,
    r: BONUS_R,
    vx,
    vz,
    alive: true,
    mesh,
    sharedGeometry: true,
    sharedMaterial: true,
  });
}

function spawnBonus() {
  const half = FIELD_W / 2;
  spawnPickup(
    "shield",
    -half + BONUS_R + Math.random() * (FIELD_W - BONUS_R * 2),
    -FIELD_D / 2 - BONUS_R,
    (Math.random() - 0.5) * 1.2,
    2.1
  );
}

function collectBonus(bonus) {
  bonus.alive = false;
  const def = BONUS_DEFS[bonus.kind];
  if (def) def.apply(state.player);
  burst(bonus.x, bonus.z, def ? def.burst : "#ffffff", 12);
}

function releaseDrop(rock) {
  if (!rock.drop) return;
  const kind = rock.drop;
  rock.drop = null;
  spawnPickup(kind, rock.x, rock.z, (Math.random() - 0.5) * 0.7, 1.2);
}

function separateRock(player, rock) {
  const dx = rock.x - player.x;
  const dz = rock.z - player.z;
  const dist = Math.hypot(dx, dz) || 0.001;
  const gap = player.r + rock.r + 0.08;
  rock.x = player.x + (dx / dist) * gap;
  rock.z = player.z + (dz / dist) * gap;
}

function spawnFromTop() {
  const tier = pickTier();
  const spec = TIERS[tier];
  const difficulty = 1 + Math.min(state.time, 90) / 120;
  const half = FIELD_W / 2;
  spawnRock(
    -half + spec.r + Math.random() * (FIELD_W - spec.r * 2),
    -FIELD_D / 2 - spec.r,
    tier,
    (Math.random() - 0.5) * 1.6,
    spec.speed * difficulty,
    rollRockDrop()
  );
}

function burst(x, z, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.4 + Math.random() * 4.2;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(debrisGeo, material);
    scene.add(mesh);
    state.particles.push({
      x,
      y: 0,
      z,
      vx: Math.cos(angle) * speed,
      vy: (Math.random() - 0.5) * speed * 0.55,
      vz: Math.sin(angle) * speed,
      life: 0.28 + Math.random() * 0.28,
      age: 0,
      alive: true,
      mesh,
      sharedGeometry: true,
    });
  }
}

function destroyRock(rock) {
  rock.alive = false;
  releaseDrop(rock);
  state.score += TIERS[rock.tier].score;
  burst(rock.x, rock.z, TIERS[rock.tier].edge, 8 + rock.tier * 2);
  if (rock.tier >= 2) return;

  const awayX = rock.x - state.player.x;
  const awayZ = rock.z - state.player.z;
  const base = Math.atan2(awayZ, awayX);
  for (const side of [-1, 1]) {
    const angle = base + side * 1.15;
    const spec = TIERS[rock.tier + 1];
    const distance = rock.r * 0.45 + spec.r * 0.35;
    spawnRock(
      rock.x + Math.cos(angle) * distance,
      rock.z + Math.sin(angle) * distance,
      rock.tier + 1,
      rock.vx + Math.cos(angle) * 2.6,
      rock.vz * 0.85 + Math.sin(angle) * 1.3
    );
  }
}

function healthPercent() {
  return Math.round((Math.max(0, state.health) / HITS_PER_LIFE) * 100);
}

function clearWeapon(player, kind) {
  player.weapons.delete(kind);
  delete player.weaponTime[kind];
}

function tickWeapons(player, dt) {
  for (const kind of [...player.weapons]) {
    const def = BONUS_DEFS[kind];
    if (!def || def.duration == null) continue;
    player.weaponTime[kind] = (player.weaponTime[kind] || 0) - dt;
    if (player.weaponTime[kind] <= 0) clearWeapon(player, kind);
  }
}

function hurt() {
  for (const kind of [...state.player.weapons]) {
    if (BONUS_DEFS[kind] && BONUS_DEFS[kind].lostOnHit) clearWeapon(state.player, kind);
  }
  state.health -= 1;
  state.shake = 11;
  state.flash = 0.28;
  state.player.invuln = 1.45;
  burst(state.player.x, state.player.z, "#f4f0e6", 14);
  if (state.health > 0) return;
  state.lives -= 1;
  if (state.lives <= 0) {
    state.health = 0;
    finishGame();
    return;
  }
  state.health = HITS_PER_LIFE;
}

function movingLeft() {
  return held.has("ArrowLeft") || held.has("KeyA") || held.has("KeyQ") || held.has("a") || held.has("q");
}
function movingRight() {
  return held.has("ArrowRight") || held.has("KeyD") || held.has("d");
}
function movingUp() {
  return held.has("ArrowUp") || held.has("KeyW") || held.has("KeyZ") || held.has("w") || held.has("z");
}
function movingDown() {
  return held.has("ArrowDown") || held.has("KeyS") || held.has("s");
}
function firing() {
  return held.has("Space") || held.has(" ");
}

function emitBullet(x, z, geometry, material, radius) {
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  state.bullets.push({
    x,
    z,
    z0: z,
    r: radius,
    vz: -BULLET_SPEED,
    alive: true,
    mesh,
    sharedGeometry: true,
    sharedMaterial: true,
  });
}

function fireWeapons(player) {
  emitBullet(player.x, player.z - 0.7, bulletGeo, bulletMat, 0.1);
  if (!player.weapons.has("cannons")) return;
  emitBullet(player.x - CANNON_X, player.z - 0.22, sideBulletGeo, sideBulletMat, 0.07);
  emitBullet(player.x + CANNON_X, player.z - 0.22, sideBulletGeo, sideBulletMat, 0.07);
}

function segmentHitsCircle(x0, z0, x1, z1, cx, cz, radius) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / len2)) : 0;
  const ox = x0 + dx * t - cx;
  const oz = z0 + dz * t - cz;
  return ox * ox + oz * oz <= radius * radius;
}

function updateStars(dt) {
  const drift = 1 + Math.min(state.time, 60) / 140;
  const positions = starPositions;
  state.stars.forEach((star, index) => {
    star.z += (0.9 + star.depth * 4.8) * drift * dt;
    if (star.z > FIELD_D * 0.72) {
      star.z = -FIELD_D * 0.95;
      star.x = (Math.random() - 0.5) * FIELD_W * 1.6;
    }
    positions[index * 3] = star.x;
    positions[index * 3 + 1] = star.y;
    positions[index * 3 + 2] = star.z;
  });
  const points = scene.children.find((child) => child.isPoints);
  if (points) points.geometry.attributes.position.needsUpdate = true;
}

function updateParticles(dt) {
  for (const part of state.particles) {
    part.age += dt;
    part.x += part.vx * dt;
    part.y += part.vy * dt;
    part.z += part.vz * dt;
  }
}

function updateLane(dt) {
  lane.position.z += 2.4 * dt;
  if (lane.position.z > 2) lane.position.z -= 2;
}

function update(dt) {
  updateStars(dt);
  updateParticles(dt);
  updateLane(dt);
  state.shake = Math.max(0, state.shake - dt * 30);
  state.flash = Math.max(0, state.flash - dt);
  state.particles = state.particles.filter((part) => {
    if (part.age < part.life) return true;
    dropMesh(part);
    return false;
  });
  if (state.mode !== "play") return;

  state.time += dt;
  const player = state.player;
  player.cool = Math.max(0, player.cool - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.shield = Math.max(0, player.shield - dt);
  tickWeapons(player, dt);

  let mx = 0;
  let mz = 0;
  if (movingLeft()) mx -= 1;
  if (movingRight()) mx += 1;
  if (movingUp()) mz -= 1;
  if (movingDown()) mz += 1;
  player.bank = mx;
  player.pitch = mz;
  if (mx || mz) {
    const len = Math.hypot(mx, mz);
    player.x += (mx / len) * SHIP_SPEED * dt;
    player.z += (mz / len) * SHIP_SPEED * dt;
  }
  const halfW = FIELD_W / 2;
  const halfD = FIELD_D / 2;
  player.x = Math.max(-halfW + 0.7, Math.min(halfW - 0.7, player.x));
  player.z = Math.max(-halfD + 1.2, Math.min(halfD - 0.7, player.z));

  if (firing() && player.cool <= 0) {
    player.cool = FIRE_COOLDOWN;
    fireWeapons(player);
  }

  for (const bullet of state.bullets) {
    bullet.z0 = bullet.z;
    bullet.z += bullet.vz * dt;
    if (bullet.z < -halfD - 1) bullet.alive = false;
  }

  for (const rock of state.rocks) {
    rock.x += rock.vx * dt;
    rock.z += rock.vz * dt;
    rock.rot += rock.spin * dt;
    if (rock.x < -halfW + rock.r) {
      rock.x = -halfW + rock.r;
      rock.vx = Math.abs(rock.vx) || 0.7;
    } else if (rock.x > halfW - rock.r) {
      rock.x = halfW - rock.r;
      rock.vx = -Math.abs(rock.vx) || -0.7;
    }
    if (rock.z > halfD + rock.r + 0.4) rock.alive = false;
  }

  const targets = state.rocks.slice();
  for (const bullet of state.bullets) {
    if (!bullet.alive) continue;
    for (const rock of targets) {
      if (!rock.alive) continue;
      if (segmentHitsCircle(bullet.x, bullet.z0, bullet.x, bullet.z, rock.x, rock.z, rock.r + bullet.r)) {
        bullet.alive = false;
        destroyRock(rock);
        break;
      }
    }
  }

  for (const bonus of state.bonuses) {
    bonus.x += bonus.vx * dt;
    bonus.z += bonus.vz * dt;
    if (bonus.x < -halfW + bonus.r) {
      bonus.x = -halfW + bonus.r;
      bonus.vx = Math.abs(bonus.vx) || 0.4;
    } else if (bonus.x > halfW - bonus.r) {
      bonus.x = halfW - bonus.r;
      bonus.vx = -Math.abs(bonus.vx) || -0.4;
    }
    if (bonus.z > halfD + 1) bonus.alive = false;
    const dx = player.x - bonus.x;
    const dz = player.z - bonus.z;
    if (dx * dx + dz * dz <= (player.r + bonus.r) * (player.r + bonus.r)) collectBonus(bonus);
  }

  for (const rock of state.rocks) {
    if (!rock.alive) continue;
    const dx = player.x - rock.x;
    const dz = player.z - rock.z;
    if (dx * dx + dz * dz > (player.r + rock.r) * (player.r + rock.r)) continue;
    if (player.shield > 0) {
      separateRock(player, rock);
      continue;
    }
    if (player.invuln <= 0) {
      hurt();
      break;
    }
  }

  const shieldOnField = state.bonuses.some((bonus) => bonus.alive && bonus.kind === "shield");
  if (!shieldOnField) {
    state.bonusAcc += dt;
    if (state.bonusAcc >= state.bonusEvery) {
      state.bonusAcc = 0;
      state.bonusEvery = 20 + Math.random() * 14;
      spawnBonus();
    }
  }

  state.spawnAcc += dt;
  const interval = Math.max(0.32, 1.15 - state.time * 0.016);
  if (state.spawnAcc >= interval && state.rocks.filter((rock) => rock.alive).length < 14) {
    state.spawnAcc = 0;
    spawnFromTop();
  }

  state.bullets = state.bullets.filter((bullet) => {
    if (bullet.alive) return true;
    dropMesh(bullet);
    return false;
  });
  state.rocks = state.rocks.filter((rock) => {
    if (rock.alive) return true;
    dropMesh(rock);
    return false;
  });
  state.bonuses = state.bonuses.filter((bonus) => {
    if (bonus.alive) return true;
    dropMesh(bonus);
    return false;
  });
}

function syncScene() {
  const player = state.player;
  if (!player) return;

  ship.position.set(player.x, 0, player.z);
  ship.rotation.set(-(player.pitch || 0) * 0.16, 0, -(player.bank || 0) * 0.42);
  const flame = ship.getObjectByName("flame");
  flame.visible = state.mode !== "over";
  flame.scale.set(1, 1, 0.65 + Math.sin(state.time * 42) * 0.32);
  const blink = state.mode === "play" && player.invuln > 0 && Math.floor(state.time * 14) % 2 === 0;
  ship.visible = !blink;
  const armed = player.weapons.has("cannons");
  ship.getObjectByName("cannon-port").visible = armed;
  ship.getObjectByName("cannon-starboard").visible = armed;
  const pulse = 0.5 + Math.sin(state.time * 9) * 0.5;
  shieldMesh.visible = player.shield > 0 && state.mode === "play";
  shieldMesh.position.set(player.x, 0.12, player.z);
  shieldMat.opacity = 0.28 + pulse * 0.22;
  shieldRingMat.opacity = 0.55 + pulse * 0.4;

  for (const bonus of state.bonuses) {
    bonus.mesh.position.set(bonus.x, Math.sin(state.time * 3 + bonus.x) * 0.12, bonus.z);
    bonus.mesh.rotation.y = state.time * 1.4;
  }

  for (const rock of state.rocks) {
    rock.mesh.position.set(rock.x, 0, rock.z);
    rock.mesh.rotation.set(rock.tumble + rock.rot * 0.35, rock.rot, rock.rot * 0.2);
    if (rock.marker) {
      rock.marker.rotation.y = state.time * 2.8;
      rock.marker.position.y = rock.r * 0.92 + Math.sin(state.time * 4 + rock.x) * 0.05;
    }
  }
  for (const bullet of state.bullets) {
    bullet.mesh.position.set(bullet.x, 0, bullet.z);
  }
  for (const part of state.particles) {
    part.mesh.position.set(part.x, part.y, part.z);
    part.mesh.material.opacity = Math.max(0, 1 - part.age / part.life);
  }

  const shake = state.shake * 0.012;
  camera.position.set(
    player.x * 0.28 + (Math.random() - 0.5) * shake,
    15.5,
    player.z + 8.2
  );
  camera.lookAt(player.x * 0.12, 0, player.z - 7.5);
}

function makeLifeIcon() {
  const mark = document.createElement("span");
  mark.className = "life";
  mark.innerHTML = '<svg viewBox="0 0 20 24" aria-hidden="true"><path d="M10 1.2 L17.6 22.6 L10 17 L2.4 22.6 Z" fill="#f7f4ec" stroke="#7fd4ff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  return mark;
}

function healthColor(percent) {
  if (percent > 60) return "#7ddea0";
  if (percent > 30) return "#f0c14a";
  return "#e15b4a";
}

function renderHud() {
  flash.style.opacity = String(Math.max(0, state.flash * 0.85));
  if (state.mode === "menu") return;
  hudScore.textContent = String(state.score).padStart(6, "0");
  hudHelp.hidden = state.mode !== "play";
  const lives = hudLives.childElementCount;
  if (lives !== state.lives) {
    hudLives.replaceChildren();
    for (let i = 0; i < state.lives; i++) hudLives.append(makeLifeIcon());
    hudLives.setAttribute("aria-label", "Lives: " + state.lives);
  }
  const percent = healthPercent();
  healthFill.style.width = percent + "%";
  healthFill.style.background = healthColor(percent);
  healthLabel.textContent = percent + "%";
  healthMeter.setAttribute("aria-valuenow", String(percent));
}

function render() {
  syncScene();
  renderHud();
  renderer.render(scene, camera);
}

const SCORE_KEY = "zenamax-scores";
const MAX_SCORES = 8;
const menu = document.getElementById("menu");
const gameover = document.getElementById("gameover");
const scoreRows = document.getElementById("score-rows");
const nameForm = document.getElementById("name-form");
const pilotName = document.getElementById("pilot-name");
const scoreNote = document.getElementById("score-note");
const finalScore = document.getElementById("final-score");
let activeScoreId = null;

function loadScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((row) => {
      return row && typeof row.id === "string" && typeof row.name === "string" && Number.isFinite(row.score);
    }).slice(0, MAX_SCORES);
  } catch (error) {
    return [];
  }
}

function writeScores(rows) {
  localStorage.setItem(SCORE_KEY, JSON.stringify(rows.slice(0, MAX_SCORES)));
}

function cleanName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 12);
  return name || "PILOT";
}

function makeScoreId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function renderScores(highlightId) {
  scoreRows.replaceChildren();
  const rows = loadScores();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "No scores yet";
    tr.append(td);
    scoreRows.append(tr);
    return;
  }
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (row.id === highlightId) tr.className = "latest";
    const rank = document.createElement("td");
    rank.textContent = String(index + 1);
    const name = document.createElement("td");
    name.textContent = row.name;
    const score = document.createElement("td");
    score.textContent = String(row.score);
    tr.append(rank, name, score);
    scoreRows.append(tr);
  });
}

function recordScore() {
  activeScoreId = null;
  if (state.score <= 0) return null;
  const rows = loadScores();
  rows.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0));
  if (rows.length >= MAX_SCORES && state.score < rows[rows.length - 1].score) return null;
  const entry = {
    id: makeScoreId(),
    name: "PILOT",
    score: state.score,
    at: Date.now(),
  };
  rows.push(entry);
  rows.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0));
  const kept = rows.slice(0, MAX_SCORES);
  if (!kept.some((row) => row.id === entry.id)) return null;
  try {
    writeScores(kept);
  } catch (error) {
    return null;
  }
  activeScoreId = entry.id;
  return entry;
}

function renameActive(name) {
  if (!activeScoreId) return;
  const rows = loadScores();
  const row = rows.find((item) => item.id === activeScoreId);
  if (!row) return;
  row.name = cleanName(name);
  try {
    writeScores(rows);
  } catch (error) {
    return;
  }
  renderScores(activeScoreId);
}

function showMenu() {
  state.mode = "menu";
  state.over = false;
  held.clear();
  menu.hidden = false;
  gameover.hidden = true;
  hud.hidden = true;
  renderScores(activeScoreId);
  document.getElementById("start").focus();
}

function startGame() {
  if (state.mode === "play") return;
  held.clear();
  reset();
  menu.hidden = true;
  gameover.hidden = true;
  hud.hidden = false;
  canvas.focus();
}

function finishGame() {
  state.over = true;
  state.mode = "over";
  held.clear();
  finalScore.textContent = String(state.score).padStart(6, "0");
  const entry = recordScore();
  nameForm.hidden = !entry;
  scoreNote.textContent = entry
    ? "Saved. Change the name if you want."
    : "Not a high score.";
  if (entry) pilotName.value = entry.name;
  menu.hidden = true;
  gameover.hidden = false;
  hud.hidden = false;
  renderScores(activeScoreId);
  if (entry) pilotName.focus();
  else document.getElementById("again").focus();
}

const BLOCKED_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

window.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing) return;
  if (state.mode !== "play") {
    if (!event.repeat && state.mode === "menu" && (event.code === "Enter" || event.code === "Space")) {
      event.preventDefault();
      startGame();
    }
    if (!event.repeat && state.mode === "over" && event.code === "KeyR") startGame();
    if (!event.repeat && state.mode === "over" && event.code === "Escape") showMenu();
    return;
  }
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
  held.add(event.code);
  if (event.key.length === 1) held.add(event.key.toLowerCase());
});

window.addEventListener("keyup", (event) => {
  held.delete(event.code);
  if (event.key.length === 1) held.delete(event.key.toLowerCase());
});

window.addEventListener("blur", () => held.clear());
window.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", () => canvas.focus());

document.getElementById("start").addEventListener("click", startGame);
document.getElementById("again").addEventListener("click", startGame);
document.getElementById("back").addEventListener("click", showMenu);
nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  renameActive(pilotName.value);
  scoreNote.textContent = "Name saved.";
  document.getElementById("again").focus();
});

resize();
makeStars();
reset();
showMenu();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.game = { state, held, reset, spawnRock, spawnBonus, spawnPickup };
