// Animated hero background: a Perlin-noise particle flow rendered to a canvas.
// Cleans up its animation frame on unmount and honours prefers-reduced-motion.
import { useEffect, useRef } from "react";

const PREFERS_REDUCED = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

function createNoise() {
  const permutation = [
    151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,
    234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
    134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,
    1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,
    124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,
    154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,
    242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,
    50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  const p = new Array(512);
  for (let i = 0; i < 256; i++) p[256 + i] = p[i] = permutation[i];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15; const u = h < 8 ? x : y; const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return {
    simplex3: (x: number, y: number, z: number) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      const u = fade(x), v = fade(y), w = fade(z);
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      return lerp(w,
        lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)), lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
        lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)), lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))));
    },
  };
}

export function FluidParticles({ particleCount = 850, noiseIntensity = 0.0026, sizeMin = 0.5, sizeMax = 2.2 }:
  { particleCount?: number; noiseIntensity?: number; sizeMin?: number; sizeMax?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true }); if (!ctx) return;
    const noise = createNoise();
    const host = canvas.parentElement; if (!host) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = () => host.clientWidth || 800, H = () => host.clientHeight || 400;
    const resize = () => { canvas.width = W() * dpr; canvas.height = H() * dpr; canvas.style.width = W() + "px"; canvas.style.height = H() + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * W(), y: Math.random() * H(),
      size: Math.random() * (sizeMax - sizeMin) + sizeMin,
      life: Math.random() * 100, maxLife: 100 + Math.random() * 50,
    }));
    let raf = 0;
    const draw = () => {
      ctx.fillStyle = "rgba(247,245,240,0.16)"; // off-white trail
      ctx.fillRect(0, 0, W(), H());
      const t = Date.now() * 0.0001;
      for (const pt of particles) {
        pt.life += 1;
        if (pt.life > pt.maxLife) { pt.life = 0; pt.x = Math.random() * W(); pt.y = Math.random() * H(); }
        const opacity = Math.sin((pt.life / pt.maxLife) * Math.PI) * 0.22;
        const a = noise.simplex3(pt.x * noiseIntensity, pt.y * noiseIntensity, t) * Math.PI * 4;
        pt.x += Math.cos(a) * 1.5; pt.y += Math.sin(a) * 1.5;
        if (pt.x < 0) pt.x = W(); if (pt.x > W()) pt.x = 0; if (pt.y < 0) pt.y = H(); if (pt.y > H()) pt.y = 0;
        ctx.fillStyle = `rgba(99,91,255,${opacity})`; // violet dust
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    if (PREFERS_REDUCED) { ctx.clearRect(0, 0, W(), H()); } else { draw(); }
    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [particleCount, noiseIntensity, sizeMin, sizeMax]);
  return <canvas ref={canvasRef} className="fluid-bg" aria-hidden="true" />;
}
