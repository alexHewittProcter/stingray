import * as THREE from 'three';
import { CLIFF_TOP, COAST_Z } from '../sim/world';

// Marineville on the clifftop, so that surfacing has a view: the checkered control tower,
// the three accommodation blocks and the two round pavilions from the series' establishing shot.

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function checker(): THREE.CanvasTexture {
  const COLS = 12;
  const ROWS = 3;
  return canvasTexture(COLS * 32, ROWS * 32, (ctx) => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#e8632c' : '#c3d2dc';
        ctx.fillRect(c * 32, r * 32, 32, 32);
      }
    }
  });
}

function balconies(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#d9d2c4';
    ctx.fillRect(0, 0, 128, 128);
    for (let floor = 0; floor < 4; floor++) {
      ctx.fillStyle = '#e2b53a';
      ctx.fillRect(10, 10 + floor * 30, 108, 12);
      ctx.fillStyle = '#5b4a3c';
      ctx.fillRect(10, 22 + floor * 30, 108, 6);
    }
  });
}

export function createMarineville(): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe6e3da });
  const grey = new THREE.MeshLambertMaterial({ color: 0x9aa0a4 });

  // Control tower: a checkered drum on a stalk, with a glazed gallery on top.
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 46, 16), grey);
  stalk.position.set(0, 23, -150);
  group.add(stalk);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(24, 6, 5, 24), grey);
  skirt.position.set(0, 46, -150);
  group.add(skirt);
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 18, 32, 1, false),
    [new THREE.MeshLambertMaterial({ map: checker() }), white, white],
  );
  drum.position.set(0, 58, -150);
  group.add(drum);
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 5, 32), new THREE.MeshLambertMaterial({ color: 0x9fc4dc }));
  gallery.position.set(0, 69.5, -150);
  group.add(gallery);

  // Three accommodation blocks with yellow balcony bands.
  const facade = new THREE.MeshLambertMaterial({ map: balconies() });
  for (const x of [-52, 0, 52]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(44, 30, 18), [white, white, white, white, facade, facade]);
    block.position.set(x, 15, -120);
    group.add(block);
  }

  // Two round pavilions nearer the cliff edge.
  for (const x of [-95, 95]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 16, 6, 28), grey);
    base.position.set(x, 3, -60);
    group.add(base);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 5, 28), white);
    deck.position.set(x, 8.5, -60);
    group.add(deck);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 5, 28), new THREE.MeshLambertMaterial({ color: 0xe2b53a }));
    band.position.set(x, 13.5, -60);
    group.add(band);
  }

  // Long low wings either side.
  for (const x of [-190, 190]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(120, 14, 22), white);
    wing.position.set(x, 7, -130);
    group.add(wing);
  }

  group.position.set(0, CLIFF_TOP, COAST_Z);
  return group;
}
