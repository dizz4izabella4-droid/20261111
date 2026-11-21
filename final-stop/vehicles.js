/* HANDS UP vehicle meshes. Points are in metres, with +y up and +z toward the hood. */
const VehicleMesh = (() => {
  const UP = [0, 1, 0], REAR = [0, 0, -1], FRONT = [0, 0, 1];
  const SUN = [-0.42, 0.83, -0.36];
  const INNER = '#1c202c', RUBBER = '#1c2027', STEEL = '#666d7a';
  const GLASS_DARK = '#182b42', GLASS_BLUE = '#496078';
  const SHADOW = 'rgba(4,5,10,.61)';
  const cache = new Map();

  function normal(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }

  function face(mesh, vertices, outward, color, shade = 1, layer = 0) {
    const n = normal(vertices[0], vertices[1], vertices[2]);
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) vertices.reverse();
    mesh.push({ vertices, color, shade, layer });
  }

  function rectX(mesh, x, y0, y1, z0, z1, side, color, shade, layer) {
    face(mesh, [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], [side, 0, 0], color, shade, layer);
  }

  function rectZ(mesh, z, x0, x1, y0, y1, dir, color, shade, layer) {
    face(mesh, [[x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]], dir, color, shade, layer);
  }

  function box(mesh, x0, x1, y0, y1, z0, z1, color) {
    rectX(mesh, x0, y0, y1, z0, z1, -1, color, 0.82);
    rectX(mesh, x1, y0, y1, z0, z1, 1, color, 0.93);
    rectZ(mesh, z0, x0, x1, y0, y1, REAR, color, 0.9);
    rectZ(mesh, z1, x0, x1, y0, y1, FRONT, color, 0.85);
    face(mesh, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], UP, color, 1.15);
    face(mesh, [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0], color, 0.58);
  }

  function wheels(mesh, wreck) {
    for (const side of [-1, 1]) for (const z of [-1.43, 1.39]) {
      const x = side * (wreck ? 0.87 : 0.9);
      const outside = [], inside = [], hub = [];
      for (let j = 0; j < 8; j++) {
        const a = (j + 0.5) * Math.PI / 4, dy = Math.cos(a), dz = Math.sin(a);
        outside.push([x, 0.355 + 0.38 * dy, z + 0.38 * dz]);
        inside.push([x - side * 0.23, 0.355 + 0.38 * dy, z + 0.38 * dz]);
        hub.push([x + side * 0.005, 0.355 + 0.195 * dy, z + 0.195 * dz]);
      }
      face(mesh, outside.slice(), [side, 0, 0], RUBBER, 0.86);
      face(mesh, inside.slice(), [-side, 0, 0], RUBBER, 0.78);
      for (let j = 0; j < 8; j++) {
        const next = (j + 1) % 8, a = (j + 1) * Math.PI / 4;
        face(mesh, [outside[j], inside[j], inside[next], outside[next]], [0, Math.cos(a), Math.sin(a)], RUBBER, j % 2 ? 0.83 : 1.25);
        face(mesh, [hub[j], hub[next], [x + side * 0.008, 0.355, z]], [side, 0, 0], STEEL, j % 4 < 2 ? 1.08 : 0.63, 0.05);
      }
    }
  }

  function sides(mesh, side, police) {
    const x = side * 0.916, n = [side, 0, 0], p = (y, z) => [x, y, z];
    for (const z of [-1.43, 1.39]) {
      const edge = [[0.34, -0.42], [0.53, -0.34], [0.69, -0.17], [0.69, 0.17], [0.53, 0.34], [0.34, 0.42]];
      for (let i = 1; i < edge.length; i++) {
        const [y0, dz0] = edge[i - 1], [y1, dz1] = edge[i];
        face(mesh, [p(y0, z + dz0), p(0.77, z + dz0), p(0.77, z + dz1), p(y1, z + dz1)], n, '$paint', 0.99);
      }
      face(mesh, [p(0.77, z - 0.42), p(0.91, z - 0.42), p(0.91, z + 0.42), p(0.77, z + 0.42)], n, '$paint', 1.17);
    }
    for (const [a, b] of [[-1.98, -1.85], [-1.01, 0.97], [1.81, 2.05]]) {
      rectX(mesh, x, 0.34, 0.51, a, b, side, '$paint', 0.58);
      rectX(mesh, x, 0.51, 0.81, a, b, side, police && a === -1.01 ? '#b5b3ad' : '$paint', 0.91);
      rectX(mesh, x, 0.81, 0.91, a, b, side, police && a === -1.01 ? '#ddd8c7' : '$paint', 1.26);
    }
    rectX(mesh, x + side * 0.006, 0.603, 0.634, -1.84, 1.80, side, INNER, 0.88, 0.04);
    for (const z of [-0.93, 0.22, 0.9]) rectX(mesh, x + side * 0.007, 0.42, 0.89, z, z + 0.028, side, INNER, 0.83, 0.04);
    rectX(mesh, x + side * 0.01, 0.766, 0.8, 0.26, 0.43, side, STEEL, 0.91, 0.05);
    for (const [end, edge, width, dir] of [[-2.23, -1.98, 0.77, -1], [2.24, 2.05, 0.72, 1]]) {
      face(mesh, [p(0.36, edge), p(0.91, edge), [side * width, 0.82, end], [side * width, 0.39, end]], [side, 0, dir * 0.55], '$paint', 0.81);
      const lamp = dir < 0 ? (side < 0 ? '$tailL' : '$tailR') : '$head';
      face(mesh, [[side * 0.917, 0.59, edge], [side * 0.917, 0.71, edge], [side * (width + 0.012), 0.71, end], [side * (width + 0.012), 0.59, end]], [side, 0, dir * 0.55], lamp, 0.77, 0.07);
    }
  }

  function rearGlassPoint(p) {
    const y = -p[1];
    return [p[0], y, -1.325 + (y - 0.9) * 1.16];
  }

  function officers(mesh, nod) {
    for (const side of [-1, 1]) {
      const x = side * 0.27, bob = side > 0 ? nod : 0;
      const pane = (dx, y) => rearGlassPoint([x + dx, -y]);
      face(mesh, [pane(-.146,.928),pane(-.122,1.02),pane(-.065,1.067),pane(.057,1.072),pane(.132,1.011),pane(.152,.928)],
        [0,.5,-1], '#202838', .96, .21);
      face(mesh, [pane(-.07,1.034+bob),pane(-.083,1.14+bob),pane(-.043,1.19+bob),pane(.047,1.19+bob),pane(.083,1.149+bob),pane(.06,1.047+bob)],
        [0,.5,-1], '#1c2538', 1.12, .3);
      face(mesh, [pane(-.091,1.146+bob),pane(-.103,1.179+bob),pane(-.043,1.221+bob),pane(.053,1.21+bob),pane(.105,1.173+bob),pane(.087,1.142+bob)],
        [0,.5,-1], '#39465a', .95, .35);
    }
  }

  function cabin(mesh, damage, crushSide, police, driver) {
    const z0 = -1.32, z1 = 1.23, roofRear = -0.69, roofFront = 0.59, low = 0.9, high = 1.45;
    const roof = [[-0.62, high, roofRear], [-0.62, high, roofFront], [0.62, high, roofFront], [0.62, high, roofRear]];
    if (damage < 2) face(mesh, roof.slice(), UP, '$roof', 1.19);
    else {
      const jag = [[crushSide * 0.62, high, 0.46], [crushSide * 0.16, high, 0.12], [crushSide * 0.36, high, -0.12], [crushSide * 0.08, high, -0.31], [crushSide * 0.25, high, roofRear]];
      face(mesh, [[-crushSide * 0.62, high, roofRear], [-crushSide * 0.62, high, roofFront], [crushSide * 0.62, high, roofFront], ...jag], UP, '$roof', 1.1);
      face(mesh, [[crushSide * 0.58, high - 0.16, roofRear], [crushSide * 0.59, high - 0.15, 0.49], ...jag.slice().reverse()], UP, INNER, 0.8);
    }
    const glass = [[-.65, -.9135], [-.511, -1.3775], [.511, -1.3775], [.65, -.9135]].map(rearGlassPoint);
    const rear = [[-0.79, low, z0], roof[0], roof[3], [0.79, low, z0]];
    const windowBed = damage ? '#111823' : GLASS_DARK;
    face(mesh, rear, [0, 0.5, -1], '$roof', 0.87);
    face(mesh, glass, [0, 0.5, -1], windowBed, 0.84, 0.06);
    if (!damage) face(mesh, [rearGlassPoint([-0.626, -0.94]), rearGlassPoint([-0.501, -1.36]), rearGlassPoint([-0.23, -1.36]), rearGlassPoint([-0.34, -0.94])], [0, 0.5, -1], GLASS_BLUE, 0.92, 0.09);
    face(mesh, [[-0.79, low, z1], [0.79, low, z1], roof[2], roof[1]], [0, 0.55, 1], '$roof', 0.92);
    face(mesh, [[-0.69, 0.94, 1.19], [0.69, 0.94, 1.19], [0.53, 1.39, 0.68], [-0.53, 1.39, 0.68]], [0, 0.55, 1], GLASS_DARK, 1.08, 0.08);
    face(mesh, [[-0.65, 0.96, 1.17], [-0.48, 1.37, 0.72], [-0.18, 1.37, 0.72]], [0, 0.55, 1], GLASS_BLUE, 0.91, 0.09);
    for (const side of [-1, 1]) {
      const pane = (y, z) => [side * (0.8 - (y - low) * 0.32), y, z];
      const shell = [pane(low, z0), pane(high, roofRear), pane(high, roofFront), pane(low, z1)];
      const back = [pane(.955, -1.18), pane(1.38, -0.62), pane(1.38, 0.08), pane(.955, 0.08)];
      const front = [pane(.955, 0.17), pane(1.38, 0.17), pane(1.38, 0.56), pane(.955, 1.12)];
      const torn = damage > 1 && side === crushSide, n = [side, 0.3, 0];
      face(mesh, shell, n, '$roof', 0.88);
      face(mesh, back, n, torn ? INNER : GLASS_DARK, 1, 0.06);
      face(mesh, front, n, GLASS_DARK, 1.18, 0.06);
      if (!torn) face(mesh, [pane(.955, -0.83), pane(1.38, -0.57), pane(1.38, -0.39), pane(.955, -0.57)], n, GLASS_BLUE, 0.86, 0.09);
      if (driver) {
        face(mesh, [pane(.955, 0.29), pane(1.12, 0.28), pane(1.17, 0.44), pane(1.09, 0.63), pane(.955, 0.72)], n, '#172027', 0.92, 0.1);
        face(mesh, [pane(1.14, 0.38), pane(1.29, 0.33), pane(1.34, 0.47), pane(1.3, 0.57), pane(1.18, 0.58)], n, '#78615d', 0.56, 0.1);
      }
      if (police) face(mesh, [pane(0.94, -0.34), pane(1.14, -0.43), pane(1.28, -0.3), pane(1.26, -0.07), pane(1.06, 0.01), pane(0.94, 0.1)], n, '#141b2d', 0.92, 0.12);
      box(mesh, side < 0 ? -0.99 : 0.85, side < 0 ? -0.85 : 0.99, 0.99, 1.07, 0.82, 0.97, '$roof');
    }
    if (police) {
      box(mesh, -0.64, 0.64, 1.446, 1.52, -0.21, 0.19, '#252c3b');
      box(mesh, -0.59, -0.065, 1.52, 1.64, -0.17, 0.16, '$barL');
      box(mesh, 0.065, 0.59, 1.52, 1.64, -0.17, 0.16, '$barR');
    }
  }

  const markings = [
    ['110','101','110','100','100'], ['010','101','101','101','010'],
    ['100','100','100','100','111'], ['111','010','010','010','111'],
    ['011','100','100','100','011'], ['111','100','110','100','111']
  ];

  function body(mesh, damage, crushSide, police, parked) {
    for (const side of [-1, 1]) {
      sides(mesh, side, police);
      const p = (x, y, z) => [side * x, y, z];
      face(mesh, [p(0.77, 0.82, -2.23), p(0.916, 0.91, -1.98), p(0.916, 0.91, 2.05), p(0.72, 0.82, 2.24), p(0.72, 0.87, 1.22), p(0.79, 0.9, -1.32)], UP, '$paint', 1.23);
    }
    rectZ(mesh, 2.24, -0.72, 0.72, 0.39, 0.82, FRONT, '$paint', 0.76);
    rectZ(mesh, 2.251, -0.34, 0.34, 0.58, 0.73, FRONT, '#141925', 0.9, 0.05);
    rectZ(mesh, 2.25, -0.59, 0.59, 0.42, 0.48, FRONT, STEEL, 0.8, 0.05);
    for (const side of [-1, 1]) {
      const x = side * 0.544;
      rectZ(mesh, 2.255, x - 0.154, x + 0.154, 0.595, 0.754, FRONT, '$head', 1.13, 0.07);
    }
    face(mesh, [[-.72,.82,2.24],[-.79,.9,1.22],[.79,.9,1.22],[.72,.82,2.24]], UP, '$paint', 1.21);
    face(mesh, [[-.52,.837,2.23],[-.39,.92,1.22],[.39,.92,1.22],[.52,.837,2.23]], UP, '$paint', 1.38, 0.04);
    face(mesh, [[-.79,.9,-1.32],[-.79,.9,1.22],[.79,.9,1.22],[.79,.9,-1.32]], UP, INNER, 0.8);
    if (damage < 2) {
      const trunk = [[-.77,.82,-2.23],[-.79,.9,-1.32],[.79,.9,-1.32],[.77,.82,-2.23]];
      face(mesh, trunk, UP, police ? '#d6d2c8' : '$paint', 1.13);
      face(mesh, [[-.65,.835,-2.17],[-.64,.895,-1.5],[.64,.895,-1.5],[.65,.835,-2.17]], UP, police ? '#dfded6' : '$paint', 1.27, 0.051);
      rectZ(mesh, -2.23, -0.77, 0.77, 0.39, 0.82, REAR, police ? '#b6bac2' : '$paint', 0.9);
      box(mesh, -.86, .86, .34, .465, -2.33, -2.1, '#4a4652');
      rectZ(mesh, -2.337, -0.74, 0.74, 0.418, 0.452, REAR, STEEL, 0.94, 0.07);
      if (!parked) {
        rectZ(mesh, -2.247, -0.188, 0.188, .483, .572, REAR, '#e1cc9a', 1.03, 0.07);
        rectZ(mesh, -2.252, -0.129, 0.129, .51, .532, REAR, '#353b4a', 0.86, 0.08);
      }
    } else {
      const jag = [[-.77,.82,-2.23],[-.58,.68,-2.22],[-.48,.73,-2.2],[-.25,.6,-2.23],[.28,.63,-2.21],[.45,.73,-2.225],[.63,.67,-2.22],[.77,.82,-2.23]];
      face(mesh, [[-.77,.39,-2.23],[.77,.39,-2.23], ...jag.slice().reverse()], REAR, '$paint', 0.75);
      face(mesh, [[-.77,.82,-2.23],[-.79,.9,-1.32],[-.53,.895,-1.38],[-.48,.73,-2.2],[-.58,.68,-2.22]], UP, '$paint', 1.12);
      face(mesh, [[.77,.82,-2.23],[.79,.9,-1.32],[.53,.89,-1.4],[.45,.73,-2.225],[.63,.67,-2.22]], UP, '$paint', 1.22);
      face(mesh, [[-.57,.45,-1.98],[-.56,.68,-1.36],[.53,.67,-1.36],[.62,.44,-1.96]], UP, INNER, 0.72);
      face(mesh, [[-.53,.46,-1.84],[-.24,.47,-1.35],[.28,.47,-1.44],[.51,.5,-1.85]], UP, '#4b4650', 0.92, .05);
      face(mesh, [[-.76,.37,-2.29],[-.34,.31,-2.45],[.22,.38,-2.31],[.15,.46,-2.22]], REAR, STEEL, 0.86, .07);
    }
    if (police) {
      for (let letter = 0; letter < markings.length; letter++) {
        for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
          if (markings[letter][row][col] !== '1') continue;
          const x = -0.33 + letter * 0.115 + col * 0.028, y = 0.786 - row * 0.025;
          rectZ(mesh, -2.248, x, x + 0.029, y - 0.023, y, REAR, '#252e41', 0.9, 0.06);
        }
      }
    }
    if (damage > 0) {
      const s = crushSide;
      face(mesh, [[s*.76,.79,-2.259],[s*.43,.74,-2.259],[s*.25,.63,-2.26],[s*.39,.59,-2.26],[s*.23,.48,-2.26],[s*.73,.45,-2.26]], REAR, '#422534', 1.12, 0.09);
      for (let i = 0; i < 4; i++) {
        const x = s * (.4 + i * .075), y = .495 + i * .051;
        face(mesh, [[x,y,-2.27],[x+s*.026,y+.01,-2.27],[x+s*.12,y+.115,-2.27],[x+s*.083,y+.11,-2.27]], REAR, '#ccc0ab', .9 - i * .13, .11);
      }
    }
  }

  function wreck(mesh) {
    for (const z of [-1.43, 1.39]) box(mesh, -.84, .84, .27, .4, z - .094, z + .094, STEEL);
    box(mesh, -.54, .54, .25, .45, -1.91, 1.98, '#534854');
    box(mesh, -.17, .17, .44, .72, 1.08, 1.88, '#777173');
    for (const side of [-1, 1]) {
      const x = side * .38, p = (x, y, z) => [side * x, y, z];
      box(mesh, x - .22, x + .22, .46, .62, -.54, .18, '#794936');
      box(mesh, x - .19, x + .19, .6, 1.07, -.58, -.39, '#63463e');
      box(mesh, x - .115, x + .115, 1.03, 1.18, -.56, -.42, '#65524e');
      face(mesh, [p(.49,.39,-2.08),p(.55,.63,-2.03),p(.7,.56,-1.77),p(.79,.77,-1.14),p(.85,.43,1.23),p(.8,.36,-1.64)], [side,.37,-.31], '$paint', .97);
      face(mesh, [p(.48,.39,-2.08),p(.53,.62,-2.03),p(.68,.58,-1.72),p(.77,.71,-1.13),p(.55,.51,-1.42)], UP, '$paint', 1.32);
      face(mesh, [p(.6,.47,-.77),p(.72,.91,-.63),p(.58,1.28,-.48),p(.55,1.21,-.48),p(.58,.72,-.63)], [side,0,-.24], '#783e40', .96);
    }
    rectZ(mesh, -2.015, -.46, .46, .38, .5, REAR, '#a83b40', 1.07);
    rectZ(mesh, -2.028, -.175, .175, .394, .455, REAR, '#bdb499', .85, .07);
  }

  function door(mesh, opening, damage) {
    const angle = opening * 1.35, sin = Math.sin(angle), cos = Math.cos(angle);
    const point = (y, z, inset = 0) => [-.89 - (1.05 - z) * sin + inset, y, 1.05 - (1.05 - z) * cos];
    const n = [-cos, 0, -sin], back = [cos, 0, sin];
    const shell = damage < 3
      ? [point(.4,-.04),point(.96,-.04),point(.93,1.05),point(.42,1.05)]
      : [point(.41,.25),point(.8,.23),point(.67,.42),point(.82,.51),point(.77,1.05),point(.44,1.05)];
    face(mesh, shell.slice(), n, '$paint', .89);
    face(mesh, shell.slice(), back, '#622d30', .9);
    if (damage < 3) {
      const pane = [point(.96,.06),point(1.35,.12),point(1.31,.53),point(.95,.91)];
      face(mesh, pane.slice(), n, GLASS_BLUE, .84);
      face(mesh, pane, back, GLASS_DARK, 1.1);
    }
  }

  function meshFor(o, crushSide) {
    const damage = o.damage || 0, police = !!o.police, driver = !!o.driver, parked = !!o.parked;
    const key = [damage, crushSide, police, driver, parked].join('/');
    if (!cache.has(key)) {
      const mesh = [];
      wheels(mesh, damage >= 3);
      if (damage >= 3) wreck(mesh);
      else {
        body(mesh, damage, crushSide, police, parked);
        cabin(mesh, damage, crushSide, police, driver);
      }
      cache.set(key, mesh);
    }
    return cache.get(key);
  }

  function deform(p, damage, side) {
    const [x, y, z] = p;
    if (!damage || damage >= 3 || side * x < .08 || z > -1.28 || y < .32) return p;
    const amount = Math.min(1, (side * x - .08) * 1.5) * Math.min(1, (-1.28 - z) * 1.25);
    return [x - side * amount * .13, y - amount * .105, z + amount * .23];
  }

  function paintPath(ctx, points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function draw(ctx, o) {
    const yaw = o.yaw || 0, sin = Math.sin(yaw), cos = Math.cos(yaw);
    const roll = (o.roll || 0) * Math.PI / 180, sinRoll = Math.sin(roll), cosRoll = Math.cos(roll);
    const pitch = o.pitch || 0, sinPitch = Math.sin(pitch), cosPitch = Math.cos(pitch);
    const isSide = !o.lens, depth = isSide ? 24 : o.lens / o.k;
    const cameraX = isSide ? 0 : (o.cx - o.centerX) / o.k;
    const height = isSide ? 0 : o.height;
    const hop = (o.hop || 0) / o.k, damage = o.damage || 0;
    const crushSide = o.glass?.side > 0 ? -1 : 1;
    const transform = (p, ground = false) => {
      const [x,y,z] = ground ? p : deform(p, damage, crushSide);
      const lx = ground ? x : x * cosRoll + (y - .46) * sinRoll;
      const ly = ground ? y : (y - .46) * cosRoll - x * sinRoll + .46;
      const py = ground ? ly : ly * cosPitch - z * sinPitch + hop;
      const pz = ground ? z : ly * sinPitch + z * cosPitch;
      const dx = lx * cos + pz * sin, dz = pz * cos - lx * sin;
      if (isSide) return [dx, py * .975 + dz * .222, depth + dz * .975 - py * .222];
      return [cameraX + dx, py - height, depth + (o.centered ? 0 : 2.22) + dz];
    };
    const project = p => isSide
      ? [o.cx + p[0] * o.k, o.gy - p[1] * o.k]
      : [o.centerX + p[0] * o.lens / p[2], o.horizon - p[1] * o.lens / p[2]];
    const projectFace = vertices => {
      if (isSide || vertices.every(p => p[2] >= 0.8)) return vertices.map(project);
      // Clip traffic that crosses the camera's near plane before projecting it.
      const clipped = [];
      for (let j = 0; j < vertices.length; j++) {
        const a = vertices[j], b = vertices[(j + 1) % vertices.length];
        if (a[2] >= 0.8) clipped.push(a);
        if ((a[2] >= 0.8) !== (b[2] >= 0.8)) {
          const t = (0.8 - a[2]) / (b[2] - a[2]);
          clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.8]);
        }
      }
      return clipped.map(project);
    };
    if (!isSide && (o.cx < -o.k * 4.9 || o.cx > o.centerX * 2 + o.k * 4.9)) return;
    const shadow = projectFace([[-.72,.005,-2.58], [.72,.005,-2.58], [1.03,.005,-1.8], [1.09,.005,1.7], [.79,.005,2.51], [-.79,.005,2.51], [-1.09,.005,1.7], [-1.03,.005,-1.8]].map(p => transform(p, true)));
    if (shadow.length >= 3) paintPath(ctx, shadow, SHADOW);

    const meshes = meshFor(o, crushSide), extra = [];
    if (o.door) door(extra, o.door, damage);
    if (o.police) officers(extra, o.nod || 0);
    if (o.glass && damage > 0 && damage < 3) {
      const g = o.glass;
      for (const c of g.rear.cells) {
        if (!c.alive) continue;
        face(extra, c.poly.map(rearGlassPoint), [0, .5, -1], c.poly[0][0] < -.21 ? '#647e94' : '#3a516b', .96, .12);
        extra[extra.length - 1].fracture = true;
      }
      for (const side of ['L', 'R']) for (const poly of g.bits[side]) {
        face(extra, poly.map(p => [p[0] * .93, -p[1], -2.264]), REAR, '#d8524d', .95, .13);
      }
    }
    if (damage < 2) for (const side of [-1, 1]) {
      const glass = o.glass?.tail[side < 0 ? 'L' : 'R'];
      const x = side * .595;
      rectZ(extra, -2.254, x - .17, x + .17, .59, .732, REAR, glass ? '#351723' : '$tail', 1.06, .1);
      if (!glass && !o.parked) rectZ(extra, -2.257, x - .141, x + .141, .657, .708, REAR, '$tailCore', 1.06, .11);
    }
    if (damage === 3 && o.hazard != null) {
      face(extra, [[.47,.49,-2.084],[.56,.556,-2.07],[.625,.537,-1.96],[.57,.49,-1.97]], REAR, '$tailCore', 1, .1);
    }
    const visible = [];
    for (const group of [meshes, extra]) for (const f of group) {
      const vertices = f.vertices.map(p => transform(p));
      const n = normal(vertices[0], vertices[1], vertices[2]);
      const first = vertices[0];
      const direction = isSide ? -n[2] : -(n[0] * first[0] + n[1] * first[1] + n[2] * first[2]);
      if (direction <= .000001) continue;
      const points = projectFace(vertices);
      if (points.length < 3) continue;
      const average = vertices.reduce((sum, p) => sum + p[2], 0) / vertices.length;
      visible.push({ f, points, n, average });
    }
    // The hull and cabin are convex panels. Draw their visible faces back to front,
    // with shallow offsets for trim placed on those faces.
    visible.sort((a, b) => (b.average - b.f.layer) - (a.average - a.f.layer));
    const pulse = o.strobe?.power || 0, blue = !!o.strobe?.blue;
    const light = o.light || 0;
    const haze = isSide ? 0 : Math.max(0, Math.min(.58, (depth - 65) / 300));
    for (const { f, points, n } of visible) {
      const c = faceColor(f, n, o, light, pulse, blue, haze);
      paintPath(ctx, points, c);
      if (f.fracture && o.k > 20) {
        ctx.strokeStyle = '#88a2b2';
        ctx.lineWidth = .88;
        ctx.stroke();
      }
    }
  }

  function faceColor(f, n, o, light, pulse, blue, haze) {
    let base = f.color;
    if (base === '$tailL' || base === '$tailR') {
      if (o.glass?.tail[base === '$tailL' ? 'L' : 'R']) return '#351723';
      base = '$tail';
    }
    if (base === '$tail') {
      if (o.parked) return '#733236';
      if (o.brake) return '#ff7959';
      if (o.hazard != null) return o.hazard ? '#ec822e' : '#69362c';
      return '#ec403c';
    }
    if (base === '$tailCore') return o.hazard === true ? '#ffca66' : o.hazard === false ? '#914936' : '#ff7764';
    if (base === '$head') return o.parked ? '#667183' : '#fbe3ad';
    if (base === '$barL' || base === '$barR') {
      if (!o.lights) return '#414058';
      const left = base === '$barL', active = o.strobe ? (left ? !blue : blue) : (left ? o.flash : !o.flash);
      const bright = active ? .55 + pulse * .45 : .38;
      return left ? `rgb(${Math.round(249 * bright)},${Math.round(50 * bright)},${Math.round(67 * bright)})`
        : `rgb(${Math.round(75 * bright)},${Math.round(151 * bright)},${Math.round(255 * bright)})`;
    }
    if (base === '$paint') base = o.color || '#bf4145';
    if (base === '$roof') base = o.roof || o.color || '#a8343d';
    const hex = parseInt(base.slice(1), 16);
    const magnitude = Math.hypot(...n) || 1;
    const direct = Math.max(0, (n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]) / magnitude);
    const shade = (0.71 + direct * .26 + light * .28) * f.shade;
    const bounce = pulse * (.09 + Math.max(0, -n[2] / magnitude) * .21 + Math.max(0, n[1] / magnitude) * .06);
    const red = (blue ? 30 : 156) * bounce + 13 * light;
    const green = (blue ? 72 : 8) * bounce + 7 * light;
    const b = (blue ? 143 : 36) * bounce;
    const channel = (value, glow, fog) => Math.max(0, Math.min(255, Math.round((value * shade + glow) * (1 - haze) + fog * haze)));
    return `rgb(${channel(hex >> 16, red, 73)},${channel(hex >> 8 & 255, green, 69)},${channel(hex & 255, b, 90)})`;
  }

  return { draw };
})();
