import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  SPHEREX_DETECTOR_CHUNKS,
  SpherexDetectorChunk,
  BRIGHT_NAV_STARS,
} from '../data/skyCoverage';
import { ResolvedTarget, resolveCoordinates } from '../services/api';
import { NavigationTab } from '../tokens/colors';
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Globe,
  Maximize2,
  Layers,
  ChevronDown,
  X,
} from 'lucide-react';

import starsDataRaw from '../data/celestial/stars.json';
import constellationLinesRaw from '../data/celestial/constellationLines.json';
import constellationsMetaRaw from '../data/celestial/constellations.json';

interface SkyMapViewProps {
  onNavigate: (tab: NavigationTab) => void;
  onTargetResolved: (target: ResolvedTarget) => void;
  activeTarget?: ResolvedTarget;
}

// Shortest modular Right Ascension difference in degrees [0, 180]
function angularRaDiff(ra1: number, ra2: number): number {
  const diff = Math.abs(ra1 - ra2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Convert decimal degrees into standard astronomical sexagesimal format (HMS, DMS)
function formatRaDec(raDeg: number, decDeg: number): { raStr: string; decStr: string } {
  const normRa = ((raDeg % 360) + 360) % 360;
  const totalHours = normRa / 15;
  const h = Math.floor(totalHours);
  const remM = (totalHours - h) * 60;
  const m = Math.floor(remM);
  const s = ((remM - m) * 60).toFixed(1);
  const raStr = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.padStart(4, '0')}s`;

  const sign = decDeg >= 0 ? '+' : '-';
  const absDec = Math.abs(decDeg);
  const d = Math.floor(absDec);
  const remArcmin = (absDec - d) * 60;
  const arcmin = Math.floor(remArcmin);
  const arcsec = Math.round((remArcmin - arcmin) * 60);
  const decStr = `${sign}${String(d).padStart(2, '0')}° ${String(arcmin).padStart(2, '0')}' ${String(arcsec).padStart(2, '0')}"`;

  return { raStr, decStr };
}

// Color temperature conversion from B-V color index
function getBvColor(bv: number): string {
  if (bv < 0.0) return '#93C5FD'; // Blue (O/B stars, e.g. Rigel)
  if (bv < 0.4) return '#FFFFFF'; // White (A/F stars, e.g. Sirius, Vega)
  if (bv < 0.8) return '#FEF08A'; // Warm yellow (G stars, Sun-like)
  if (bv < 1.4) return '#FDBA74'; // Amber orange (K stars, Arcturus)
  return '#FCA5A5'; // Red-orange (M stars, Betelgeuse, Antares)
}

const MAJOR_CONSTELLATIONS = new Set([
  'Ori', 'UMa', 'Cas', 'Cyg', 'Tau', 'Sco', 'Peg', 'Leo', 'Cru',
  'Oph', 'And', 'Dra', 'Dor', 'Aur', 'Hya', 'Sgr', 'Ind', 'Vir', 'Boo', 'CVn',
]);
const PRIMARY_STARS = new Set(['Sirius', 'Canopus', 'Vega', 'Arcturus', 'Rigel', 'Betelgeuse', 'Polaris', 'Aldebaran', 'Antares', 'Spica']);

export const SkyMapView: React.FC<SkyMapViewProps> = ({ onNavigate, onTargetResolved, activeTarget }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Projection Mode: 'sphere' (3D Planetarium) vs 'panoramic' (2:1 All-Sky Map)
  const [projection, setProjection] = useState<'sphere' | 'panoramic'>('sphere');

  // 3D Celestial Sphere Camera Orientation (Natural human optical FOV = 55 deg)
  const [yaw, setYaw] = useState<number>(180); // 0 to 360 deg
  const [pitch, setPitch] = useState<number>(0); // -85 to +85 deg
  const [fov, setFov] = useState<number>(55); // Natural Human FOV (20 to 75 deg)

  // 2D Panoramic Viewport Transform
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Dragging interaction state
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const sphereStartRef = useRef<{ yaw: number; pitch: number }>({ yaw: 180, pitch: 0 });
  const hasDraggedRef = useRef<boolean>(false);

  // Consolidated Layer Toggles
  const [showChunks, setShowChunks] = useState<boolean>(true);
  const [showPhotoSky, setShowPhotoSky] = useState<boolean>(true);
  const [showConstellations, setShowConstellations] = useState<boolean>(true);
  const [showConstellationLabels, setShowConstellationLabels] = useState<boolean>(true);
  const [showStars, setShowStars] = useState<boolean>(true);
  const [showGraticule, setShowGraticule] = useState<boolean>(true);
  const [isLayersOpen, setIsLayersOpen] = useState<boolean>(false);
  const layersBtnRef = useRef<HTMLButtonElement | null>(null);
  const layersMenuRef = useRef<HTMLDivElement | null>(null);

  // Hover & Selection State
  const [hoveredCoords, setHoveredCoords] = useState<{ ra: number; dec: number } | null>(null);
  const [hoveredChunk, setHoveredChunk] = useState<SpherexDetectorChunk | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<SpherexDetectorChunk | null>(null);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [isTextureLoaded, setIsTextureLoaded] = useState<boolean>(false);

  // WebGL Context and Program References
  const glContextRef = useRef<{
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    program: WebGLProgram;
    texture: WebGLTexture | null;
    uniforms: {
      u_resolution: WebGLUniformLocation | null;
      u_yaw: WebGLUniformLocation | null;
      u_pitch: WebGLUniformLocation | null;
      u_fov: WebGLUniformLocation | null;
      u_mode: WebGLUniformLocation | null;
      u_pan: WebGLUniformLocation | null;
      u_zoom: WebGLUniformLocation | null;
      u_texture: WebGLUniformLocation | null;
    };
  } | null>(null);

  // Cast celestial datasets
  const stars = useMemo(() => starsDataRaw as [number, number, number, number][], []);
  const constellationLines = useMemo(
    () => constellationLinesRaw as { id: string; lines: [number, number][][] }[],
    []
  );
  const constellations = useMemo(
    () => constellationsMetaRaw as { id: string; name: string; ra: number; dec: number }[],
    []
  );

  // Unified SPHEREx detector footprints including dynamic active target footprint if outside preset grid
  const allChunks = useMemo<SpherexDetectorChunk[]>(() => {
    const base = [...SPHEREX_DETECTOR_CHUNKS];
    const rawRa = activeTarget?.coordinates?.ra_deg;
    const tDec = activeTarget?.coordinates?.dec_deg;
    if (rawRa !== undefined && tDec !== undefined) {
      const tRa = ((rawRa % 360) + 360) % 360;
      const covered = base.some(
        (c) => angularRaDiff(c.centerRa, tRa) <= c.halfWidthRa && Math.abs(c.centerDec - tDec) <= c.halfHeightDec
      );
      if (!covered) {
        const cosDec = Math.max(0.2, Math.cos((tDec * Math.PI) / 180));
        base.push({
          id: 'SPX-TGT-2040',
          name: `${activeTarget?.canonical_name || 'Target'} Field`,
          region: 'Active Target SPHEREx Footprint',
          centerRa: tRa,
          centerDec: tDec,
          halfWidthRa: Number((1.762 / cosDec).toFixed(3)),
          halfHeightDec: 1.762,
          pixelCount: '2040 × 2040 px',
          plateScale: '6.2″ / pixel',
          fovDeg: '3.5° × 3.5°',
          detectors: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
          wavelengthBands: '0.75 – 5.0 µm',
          exposures: 6,
        });
      }
    }
    return base;
  }, [activeTarget]);

  // Precompute Great-Circle Geodesic (SLERP) Constellation Arc Subdivisions
  // Eliminates all phantom cross-screen meridian wrapping lines ("extra joints") and restores natural celestial curvature
  const interpolatedConstellationLines = useMemo(() => {
    const result: { id: string; segments: { ra1: number; dec1: number; ra2: number; dec2: number }[] }[] = [];

    for (const cset of constellationLines) {
      const segments: { ra1: number; dec1: number; ra2: number; dec2: number }[] = [];
      for (const line of cset.lines) {
        if (line.length < 2) continue;
        for (let i = 0; i < line.length - 1; i++) {
          const p1Ra = ((line[i][0] % 360) + 360) % 360;
          const p1Dec = line[i][1];
          const p2Ra = ((line[i + 1][0] % 360) + 360) % 360;
          const p2Dec = line[i + 1][1];

          const r1 = (p1Ra * Math.PI) / 180;
          const d1 = (p1Dec * Math.PI) / 180;
          const v1: [number, number, number] = [
            -Math.cos(d1) * Math.sin(r1),
            Math.sin(d1),
            Math.cos(d1) * Math.cos(r1),
          ];

          const r2 = (p2Ra * Math.PI) / 180;
          const d2 = (p2Dec * Math.PI) / 180;
          const v2: [number, number, number] = [
            -Math.cos(d2) * Math.sin(r2),
            Math.sin(d2),
            Math.cos(d2) * Math.cos(r2),
          ];

          const dot = Math.max(-1.0, Math.min(1.0, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
          const theta = Math.acos(dot);
          if (theta < 0.0001) continue;

          // Number of subdivisions based on angular separation (every ~4-6 deg)
          const steps = Math.max(2, Math.min(12, Math.ceil(theta / ((5 * Math.PI) / 180))));
          const sinTheta = Math.sin(theta);

          for (let k = 0; k < steps; k++) {
            const tA = k / steps;
            const tB = (k + 1) / steps;

            const aA = Math.sin((1 - tA) * theta) / sinTheta;
            const bA = Math.sin(tA * theta) / sinTheta;
            const vA = [aA * v1[0] + bA * v2[0], aA * v1[1] + bA * v2[1], aA * v1[2] + bA * v2[2]];

            const aB = Math.sin((1 - tB) * theta) / sinTheta;
            const bB = Math.sin(tB * theta) / sinTheta;
            const vB = [aB * v1[0] + bB * v2[0], aB * v1[1] + bB * v2[1], aB * v1[2] + bB * v2[2]];

            const decA = (Math.asin(Math.max(-1.0, Math.min(1.0, vA[1]))) * 180) / Math.PI;
            const alphaA = Math.atan2(-vA[0], vA[2]);
            const raA = ((alphaA * 180) / Math.PI + 360) % 360;

            const decB = (Math.asin(Math.max(-1.0, Math.min(1.0, vB[1]))) * 180) / Math.PI;
            const alphaB = Math.atan2(-vB[0], vB[2]);
            const raB = ((alphaB * 180) / Math.PI + 360) % 360;

            // Seam wrap check: if distance > 180 deg, this sub-segment crosses the 0/360 meridian boundary!
            if (Math.abs(raB - raA) <= 180) {
              segments.push({ ra1: raA, dec1: decA, ra2: raB, dec2: decB });
            }
          }
        }
      }
      result.push({ id: cset.id, segments });
    }

    return result;
  }, [constellationLines]);

  // Close layers dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        layersMenuRef.current &&
        !layersMenuRef.current.contains(target) &&
        layersBtnRef.current &&
        !layersBtnRef.current.contains(target)
      ) {
        setIsLayersOpen(false);
      }
    };
    if (isLayersOpen) {
      window.addEventListener('mousedown', handleOutsideClick);
      return () => window.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isLayersOpen]);

  // Initialize WebGL for clean NOIRLab 4K all-sky survey background
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    const gl = (glCanvas.getContext('webgl2') || glCanvas.getContext('webgl')) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    if (!gl) return;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_pos;
      void main() {
        v_pos = a_position;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;
      varying vec2 v_pos;
      uniform vec2 u_resolution;
      uniform float u_yaw;
      uniform float u_pitch;
      uniform float u_fov;
      uniform int u_mode;
      uniform vec2 u_pan;
      uniform float u_zoom;
      uniform sampler2D u_texture;

      const float PI = 3.14159265358979323846;

      void main() {
        if (u_mode == 0) {
          // 3D Celestial Sphere Perspective Projection
          float focal = (u_resolution.y * 0.5) / tan(u_fov * 0.5);
          float rx = (v_pos.x * u_resolution.x * 0.5) / focal;
          float ry = (v_pos.y * u_resolution.y * 0.5) / focal;
          float rz = 1.0;
          vec3 r = normalize(vec3(rx, ry, rz));

          float cp = cos(u_pitch), sp = sin(u_pitch);
          vec3 r1 = vec3(r.x, r.y * cp + r.z * sp, -r.y * sp + r.z * cp);

          float cy = cos(u_yaw), sy = sin(u_yaw);
          vec3 r0 = vec3(r1.x * cy - r1.z * sy, r1.y, r1.x * sy + r1.z * cy);

          // Standard Celestial ICRS Cartesian coordinates
          vec3 v_icrs = vec3(r0.z, -r0.x, r0.y);

          // Official IAU Astrometric Matrix Transformation (ICRS to Galactic)
          vec3 v_gal = vec3(
            -0.05487566 * v_icrs.x - 0.87343705 * v_icrs.y - 0.48383507 * v_icrs.z,
             0.49410944 * v_icrs.x - 0.44482972 * v_icrs.y + 0.74698218 * v_icrs.z,
            -0.86766614 * v_icrs.x - 0.19807634 * v_icrs.y + 0.45598381 * v_icrs.z
          );

          float b = asin(clamp(v_gal.z, -1.0, 1.0));
          float l = atan(v_gal.y, v_gal.x);
          float u = fract(0.5 - l / (2.0 * PI));
          float v = clamp(0.5 - b / PI, 0.0001, 0.9999);

          gl_FragColor = texture2D(u_texture, vec2(u, v));
        } else {
          // 2:1 Panoramic Equirectangular Projection with Pan and Zoom
          float scale = min(u_resolution.x / 360.0, u_resolution.y / 180.0);
          float mapW = 360.0 * scale * u_zoom;
          float mapH = 180.0 * scale * u_zoom;

          float pixelX = (v_pos.x * 0.5 + 0.5) * u_resolution.x;
          float pixelY = (0.5 - v_pos.y * 0.5) * u_resolution.y;

          float x0 = -(mapW * 0.5) + u_resolution.x * 0.5 + u_pan.x;
          float y0 = -(mapH * 0.5) + u_resolution.y * 0.5 + u_pan.y;

          if (pixelX >= x0 && pixelX <= x0 + mapW && pixelY >= y0 && pixelY <= y0 + mapH) {
            float normX = (pixelX - x0) / mapW;
            float normY = (pixelY - y0) / mapH;

            // In our 2:1 celestial atlas, normX=0 is RA=360, normX=1 is RA=0
            // normY=0 is Dec=+90, normY=1 is Dec=-90
            float ra = (1.0 - normX) * (2.0 * PI);
            float dec = (0.5 - normY) * PI;

            vec3 v_icrs = vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec));
            vec3 v_gal = vec3(
              -0.05487566 * v_icrs.x - 0.87343705 * v_icrs.y - 0.48383507 * v_icrs.z,
               0.49410944 * v_icrs.x - 0.44482972 * v_icrs.y + 0.74698218 * v_icrs.z,
              -0.86766614 * v_icrs.x - 0.19807634 * v_icrs.y + 0.45598381 * v_icrs.z
            );

            float b = asin(clamp(v_gal.z, -1.0, 1.0));
            float l = atan(v_gal.y, v_gal.x);
            float u = fract(0.5 - l / (2.0 * PI));
            float v = clamp(0.5 - b / PI, 0.0001, 0.9999);

            gl_FragColor = texture2D(u_texture, vec2(u, v));
          } else {
            gl_FragColor = vec4(0.0196, 0.0196, 0.0274, 1.0);
          }
        }
      }
    `;

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
      u_yaw: gl.getUniformLocation(prog, 'u_yaw'),
      u_pitch: gl.getUniformLocation(prog, 'u_pitch'),
      u_fov: gl.getUniformLocation(prog, 'u_fov'),
      u_mode: gl.getUniformLocation(prog, 'u_mode'),
      u_pan: gl.getUniformLocation(prog, 'u_pan'),
      u_zoom: gl.getUniformLocation(prog, 'u_zoom'),
      u_texture: gl.getUniformLocation(prog, 'u_texture'),
    };

    const tex = gl.createTexture();

    glContextRef.current = {
      gl,
      program: prog,
      texture: tex,
      uniforms,
    };

    // Load NOIRLab 4K native all-sky survey (Eckhard Slawik 88 Constellations, clean unannotated)
    const img = new Image();
    img.src = '/celestial/noirlab_galactic_4k.jpg';
    img.onload = () => {
      if (!glContextRef.current) return;
      const { gl, texture } = glContextRef.current;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      setIsTextureLoaded(true);
    };
  }, []);

  // Draw current WebGL frame (NOIRLab 4K survey)
  const renderGL = useCallback(() => {
    if (!showPhotoSky) return;
    const glCanvas = glCanvasRef.current;
    const ctxObj = glContextRef.current;
    if (!glCanvas || !ctxObj || !ctxObj.texture) return;

    const { gl, program, texture, uniforms } = ctxObj;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(program);

    gl.uniform2f(uniforms.u_resolution, glCanvas.width, glCanvas.height);
    gl.uniform1f(uniforms.u_yaw, (yaw * Math.PI) / 180);
    gl.uniform1f(uniforms.u_pitch, (pitch * Math.PI) / 180);
    gl.uniform1f(uniforms.u_fov, (fov * Math.PI) / 180);
    gl.uniform1i(uniforms.u_mode, projection === 'sphere' ? 0 : 1);
    gl.uniform2f(uniforms.u_pan, pan.x, pan.y);
    gl.uniform1f(uniforms.u_zoom, zoom);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniforms.u_texture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [yaw, pitch, fov, projection, pan, zoom, showPhotoSky]);

  // Render WebGL scene immediately whenever camera parameters, mode, or texture state updates
  useEffect(() => {
    renderGL();
  }, [renderGL, isTextureLoaded]);

  // Coordinate Projection Function: RA/Dec to Canvas Pixel Coordinates
  const raDecToCanvas = useCallback(
    (raDeg: number, decDeg: number, width: number, height: number): { x: number; y: number; visible: boolean; inFront: boolean } => {
      if (projection === 'panoramic') {
        const normRa = ((raDeg % 360) + 360) % 360;
        const scale = Math.min(width / 360, height / 180);
        const mapW = 360 * scale;
        const mapH = 180 * scale;

        const xOffset = ((180 - normRa) / 360) * mapW;
        const yOffset = ((0 - decDeg) / 180) * mapH;

        const x = xOffset * zoom + width / 2 + pan.x;
        const y = yOffset * zoom + height / 2 + pan.y;
        return { x, y, visible: true, inFront: true };
      } else {
        // 3D Celestial Sphere Perspective Projection
        const ra = (raDeg * Math.PI) / 180;
        const dec = (decDeg * Math.PI) / 180;
        const yawRad = (yaw * Math.PI) / 180;
        const pitchRad = (pitch * Math.PI) / 180;

        // 3D Unit Vector (ICRS J2000)
        const x0 = -Math.cos(dec) * Math.sin(ra);
        const y0 = Math.sin(dec);
        const z0 = Math.cos(dec) * Math.cos(ra);

        // Rotate by yaw around Y (such that yaw=ra centers x at 0)
        const x1 = x0 * Math.cos(yawRad) + z0 * Math.sin(yawRad);
        const y1 = y0;
        const z1 = -x0 * Math.sin(yawRad) + z0 * Math.cos(yawRad);

        // Rotate by pitch around X (such that pitch=dec centers y at 0)
        const x2 = x1;
        const y2 = y1 * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
        const z2 = y1 * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);

        // Behind the camera check
        if (z2 <= 0.02) {
          return { x: -9999, y: -9999, visible: false, inFront: false };
        }

        const focal = (height / 2) / Math.tan((fov * Math.PI) / 360);
        const x = width / 2 + focal * (x2 / z2);
        const y = height / 2 - focal * (y2 / z2);

        const visible = x >= -100 && x <= width + 100 && y >= -100 && y <= height + 100;
        return { x, y, visible, inFront: true };
      }
    },
    [projection, zoom, pan, yaw, pitch, fov]
  );

  // Unprojection Function: Canvas Pixel Coordinates to RA/Dec
  const canvasToRaDec = useCallback(
    (canvasX: number, canvasY: number, width: number, height: number): { ra: number; dec: number } => {
      if (projection === 'panoramic') {
        const scale = Math.min(width / 360, height / 180);
        const mapW = 360 * scale;
        const mapH = 180 * scale;

        const xOffset = (canvasX - width / 2 - pan.x) / zoom;
        const yOffset = (canvasY - height / 2 - pan.y) / zoom;

        let normRa = 180 - (xOffset / mapW) * 360;
        normRa = ((normRa % 360) + 360) % 360;

        const dec = -(yOffset / mapH) * 180;
        const clampedDec = Math.max(-90, Math.min(90, dec));
        return { ra: normRa, dec: clampedDec };
      } else {
        const focal = (height / 2) / Math.tan((fov * Math.PI) / 360);
        const rx = (canvasX - width / 2) / focal;
        const ry = -(canvasY - height / 2) / focal;
        const rz = 1.0;
        const rLen = Math.hypot(rx, ry, rz);
        const nx = rx / rLen;
        const ny = ry / rLen;
        const nz = rz / rLen;

        const yawRad = (yaw * Math.PI) / 180;
        const pitchRad = (pitch * Math.PI) / 180;

        // Inverse X rotation (-pitch)
        const x1 = nx;
        const y1 = ny * Math.cos(pitchRad) + nz * Math.sin(pitchRad);
        const z1 = -ny * Math.sin(pitchRad) + nz * Math.cos(pitchRad);

        // Inverse Y rotation (-yaw)
        const x0 = x1 * Math.cos(yawRad) - z1 * Math.sin(yawRad);
        const y0 = y1;
        const z0 = x1 * Math.sin(yawRad) + z1 * Math.cos(yawRad);

        const decRad = Math.asin(Math.max(-1.0, Math.min(1.0, y0)));
        const alphaRad = Math.atan2(-x0, z0);
        let ra = (alphaRad * 180) / Math.PI;
        ra = ((ra % 360) + 360) % 360;
        const dec = (decRad * 180) / Math.PI;
        return { ra, dec };
      }
    },
    [projection, zoom, pan, yaw, pitch, fov]
  );

  // Clamps panoramic pan offsets to map borders so users cannot scroll into empty void
  const clampPan = useCallback((panX: number, panY: number, currentZoom: number, w: number, h: number) => {
    const scale = Math.min(w / 360, h / 180);
    const mapW = 360 * scale * currentZoom;
    const mapH = 180 * scale * currentZoom;
    const maxPanX = Math.max(0, (mapW - w) / 2);
    const maxPanY = Math.max(0, (mapH - h) / 2);

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, panX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, panY)),
    };
  }, []);

  // Smoothly center and focus onto a celestial coordinate
  const focusOnTarget = useCallback(
    (targetRa: number, targetDec: number) => {
      if (projection === 'sphere') {
        setYaw(((targetRa % 360) + 360) % 360);
        setPitch(Math.max(-85, Math.min(85, targetDec)));
        setFov(40);
      } else {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const scale = Math.min(canvas.width / 360, canvas.height / 180);
        const mapW = 360 * scale;
        const mapH = 180 * scale;

        const normRa = ((targetRa % 360) + 360) % 360;
        const xOffset = ((180 - normRa) / 360) * mapW;
        const yOffset = ((0 - targetDec) / 180) * mapH;

        const newZoom = 3.2;
        setZoom(newZoom);
        setPan(clampPan(-xOffset * newZoom, -yOffset * newZoom, newZoom, canvas.width, canvas.height));
      }
    },
    [projection, clampPan]
  );

  // Render 2D Vector Elements (Stars, Lines, SPHEREx Chunks)
  const render2D = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width <= 0 || height <= 0) return;

    // Clear transparently when photographic background is active; deep black otherwise
    if (showPhotoSky) {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#050507';
      ctx.fillRect(0, 0, width, height);
    }

    const currentScale = projection === 'sphere' ? (55 / fov) : zoom;

    // 1. Graticule Grid Hairlines
    if (showGraticule) {
      ctx.save();
      ctx.strokeStyle = '#181C26';
      ctx.lineWidth = 0.75;
      ctx.fillStyle = '#4B5563';
      ctx.font = '9px monospace';

      if (projection === 'panoramic') {
        for (let ra = 0; ra <= 360; ra += 30) {
          const { x } = raDecToCanvas(ra, 0, width, height);
          if (x >= -50 && x <= width + 50) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            const hours = (ra / 15) % 24;
            ctx.fillText(`${String(hours).padStart(2, '0')}h`, x + 4, height - 8);
          }
        }

        for (let dec = -60; dec <= 60; dec += 30) {
          const { y } = raDecToCanvas(180, dec, width, height);
          if (y >= -20 && y <= height + 20) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

            const sign = dec >= 0 ? '+' : '';
            ctx.fillText(`${sign}${dec}°`, 8, y - 4);
          }
        }

        const eq = raDecToCanvas(180, 0, width, height);
        if (eq.y >= 0 && eq.y <= height) {
          ctx.strokeStyle = '#1F2937';
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.moveTo(0, eq.y);
          ctx.lineTo(width, eq.y);
          ctx.stroke();
        }
      } else {
        // 3D Celestial Sphere Graticule: Great Circles and Parallels
        for (const dec of [-60, -30, 0, 30, 60]) {
          ctx.beginPath();
          ctx.strokeStyle = dec === 0 ? 'rgba(75, 85, 99, 0.45)' : 'rgba(31, 41, 55, 0.35)';
          ctx.lineWidth = dec === 0 ? 1.0 : 0.6;
          let prev: { x: number; y: number; inFront: boolean } | null = null;
          for (let ra = 0; ra <= 360; ra += 3) {
            const pt = raDecToCanvas(ra, dec, width, height);
            if (pt.inFront && prev && prev.inFront && Math.hypot(pt.x - prev.x, pt.y - prev.y) < width * 0.4) {
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(pt.x, pt.y);
            }
            prev = pt;
          }
          ctx.stroke();
        }

        for (let ra = 0; ra < 360; ra += 30) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(31, 41, 55, 0.3)';
          ctx.lineWidth = 0.6;
          let prev: { x: number; y: number; inFront: boolean } | null = null;
          for (let dec = -85; dec <= 85; dec += 3) {
            const pt = raDecToCanvas(ra, dec, width, height);
            if (pt.inFront && prev && prev.inFront && Math.hypot(pt.x - prev.x, pt.y - prev.y) < height * 0.4) {
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(pt.x, pt.y);
            }
            prev = pt;
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 2. Constellation Lines & Names (Spherical Geodesics, Anti-Wrapping)
    if (showConstellations) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
      ctx.lineWidth = 0.85;

      ctx.beginPath();
      for (const cset of interpolatedConstellationLines) {
        for (const seg of cset.segments) {
          const pt1 = raDecToCanvas(seg.ra1, seg.dec1, width, height);
          const pt2 = raDecToCanvas(seg.ra2, seg.dec2, width, height);

          if (projection === 'sphere') {
            if (pt1.inFront && pt2.inFront) {
              ctx.moveTo(pt1.x, pt1.y);
              ctx.lineTo(pt2.x, pt2.y);
            }
          } else {
            if (pt1.visible && pt2.visible && Math.abs(pt1.x - pt2.x) < width * 0.4) {
              ctx.moveTo(pt1.x, pt1.y);
              ctx.lineTo(pt2.x, pt2.y);
            }
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Constellation Names / Labels
    if (showConstellationLabels) {
      ctx.save();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const c of constellations) {
        const isMajor = MAJOR_CONSTELLATIONS.has(c.id);
        if (!isMajor && currentScale < 1.8) continue;

        const cRa = ((c.ra % 360) + 360) % 360;
        const { x, y, visible } = raDecToCanvas(cRa, c.dec, width, height);
        if (visible && x >= 20 && x <= width - 20 && y >= 20 && y <= height - 20) {
          ctx.fillText(c.name.toUpperCase(), x, y);
        }
      }
      ctx.restore();
    }

    // 3. SPHEREx 2048x2048 Detector Chunks (Emerald Green Squares)
    if (showChunks) {
      ctx.save();

      for (const chunk of allChunks) {
        const isHovered = hoveredChunk?.id === chunk.id;
        const isSelected = selectedChunk?.id === chunk.id;

        const raL = ((chunk.centerRa + chunk.halfWidthRa) % 360 + 360) % 360;
        const raR = ((chunk.centerRa - chunk.halfWidthRa) % 360 + 360) % 360;
        const decT = Math.min(90, chunk.centerDec + chunk.halfHeightDec);
        const decB = Math.max(-90, chunk.centerDec - chunk.halfHeightDec);

        const tl = raDecToCanvas(raL, decT, width, height);
        const tr = raDecToCanvas(raR, decT, width, height);
        const br = raDecToCanvas(raR, decB, width, height);
        const bl = raDecToCanvas(raL, decB, width, height);

        if (projection === 'sphere') {
          // In 3D sphere, all 4 corners must be in front of camera to avoid screen-spanning (-9999, -9999) streaks
          if (!tl.inFront || !tr.inFront || !br.inFront || !bl.inFront) continue;
        } else {
          // In flat panorama, skip if completely offscreen or crossing the 0/360 meridian seam
          if (!tl.visible && !tr.visible && !br.visible && !bl.visible) continue;
          if (Math.abs(tl.x - tr.x) > width * 0.4) continue;
        }

        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();

        if (isSelected) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.strokeStyle = '#34D399';
          ctx.lineWidth = 1.8;
        } else if (isHovered) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 1.5;
        } else {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
          ctx.lineWidth = 1.0;
        }

        ctx.fill();
        ctx.stroke();

        const center = raDecToCanvas(chunk.centerRa, chunk.centerDec, width, height);
        if (center.visible) {
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(center.x - 3, center.y);
          ctx.lineTo(center.x + 3, center.y);
          ctx.moveTo(center.x, center.y - 3);
          ctx.lineTo(center.x, center.y + 3);
          ctx.stroke();

          if (currentScale >= 1.6 || isHovered || isSelected) {
            ctx.fillStyle = isSelected ? '#FFFFFF' : '#34D399';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(chunk.id.replace('SPX-', ''), center.x, center.y + 11);
          }
        }
      }
      ctx.restore();
    }

    // 4. 5,044 Authentic Real Stars (Crisp Optical Pinpoints)
    if (showStars) {
      ctx.save();
      for (const star of stars) {
        const starRa = ((star[0] % 360) + 360) % 360;
        const starDec = star[1];
        const mag = star[2];
        const bv = star[3];

        const { x, y, visible } = raDecToCanvas(starRa, starDec, width, height);
        if (!visible || x < -10 || x > width + 10 || y < -10 || y > height + 10) continue;

        let r: number;
        let alpha: number;

        if (mag <= 1.0) {
          r = Math.max(1.8, (2.4 - mag * 0.4) * Math.min(1.4, Math.sqrt(currentScale)));
          alpha = 1.0;
        } else if (mag <= 3.0) {
          r = Math.max(1.2, (1.8 - (mag - 1.0) * 0.3) * Math.min(1.3, Math.sqrt(currentScale)));
          alpha = 0.95;
        } else if (mag <= 4.5) {
          r = Math.max(0.8, (1.2 - (mag - 3.0) * 0.2) * Math.min(1.1, Math.sqrt(currentScale)));
          alpha = 0.8;
        } else {
          r = Math.max(0.5, (0.8 - (mag - 4.5) * 0.15) * Math.min(1.0, Math.sqrt(currentScale)));
          alpha = 0.6;
        }

        const color = getBvColor(bv);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
      ctx.restore();

      // Primary Bright Navigation Stars
      ctx.save();
      ctx.font = '9px Inter, sans-serif';
      ctx.fillStyle = '#CBD5E1';
      ctx.textAlign = 'left';

      for (const navStar of BRIGHT_NAV_STARS) {
        const isPrimary = PRIMARY_STARS.has(navStar.name);
        if (!isPrimary && currentScale < 1.8) continue;

        const { x, y, visible } = raDecToCanvas(navStar.ra, navStar.dec, width, height);
        if (visible && x >= 10 && x <= width - 30 && y >= 10 && y <= height - 10) {
          ctx.fillText(navStar.name, x + 5, y - 3);
        }
      }
      ctx.restore();
    }
  }, [
    stars,
    interpolatedConstellationLines,
    constellations,
    allChunks,
    raDecToCanvas,
    projection,
    zoom,
    pan,
    yaw,
    pitch,
    fov,
    showPhotoSky,
    showConstellations,
    showConstellationLabels,
    showStars,
    showGraticule,
    showChunks,
    hoveredChunk,
    selectedChunk,
  ]);

  // Synchronously draw 2D vector elements on every camera / layer state update
  useEffect(() => {
    render2D();
  }, [render2D]);

  // Sync canvas dimensions with parent container without redundant buffer clearing
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!container || !canvas || !glCanvas) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0 && h > 0) {
        let sizeChanged = false;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          sizeChanged = true;
        }
        if (glCanvas.width !== w || glCanvas.height !== h) {
          glCanvas.width = w;
          glCanvas.height = h;
          sizeChanged = true;
        }
        if (sizeChanged) {
          renderGL();
          render2D();
        }
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [renderGL, render2D]);

  // Mouse Wheel Zoom: In 3D Sphere adjusts FOV (20 to 75 deg); in Panorama adjusts Zoom anchored to cursor
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (projection === 'sphere') {
      const factor = e.deltaY > 0 ? 1.06 : 0.94;
      setFov((f) => Math.max(20, Math.min(75, f * factor)));
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomMultiplier = e.deltaY < 0 ? 1.15 : 0.87;

      setZoom((prevZoom) => {
        const newZoom = Math.max(1.0, Math.min(25.0, prevZoom * zoomMultiplier));
        if (newZoom === prevZoom) return prevZoom;
        const scaleRatio = newZoom / prevZoom;

        setPan((prevPan) => {
          const rawNewPanX = mouseX - canvas.width / 2 - (mouseX - canvas.width / 2 - prevPan.x) * scaleRatio;
          const rawNewPanY = mouseY - canvas.height / 2 - (mouseY - canvas.height / 2 - prevPan.y) * scaleRatio;
          return clampPan(rawNewPanX, rawNewPanY, newZoom, canvas.width, canvas.height);
        });

        return newZoom;
      });
    }
  };

  // 1:1 Responsive Mouse Drag Interaction (Left or Middle Mouse Button) with Altitude Cosine Scaling
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) {
      e.preventDefault();
    }
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { x: pan.x, y: pan.y };
    sphereStartRef.current = { yaw, pitch };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedRef.current = true;
      }

      if (projection === 'sphere') {
        const height = canvas.height || 800;
        const focal = (height / 2) / Math.tan((fov * Math.PI) / 360);
        // Altitude cosine scaling: ensures 1:1 tactile drag at any pitch without diagonal distortion
        const cosPitch = Math.max(0.15, Math.cos((sphereStartRef.current.pitch * Math.PI) / 180));
        const dYaw = -(dx / (focal * cosPitch)) * (180 / Math.PI);
        const dPitch = (dy / focal) * (180 / Math.PI);

        setYaw(((sphereStartRef.current.yaw + dYaw) % 360 + 360) % 360);
        setPitch(Math.max(-85, Math.min(85, sphereStartRef.current.pitch + dPitch)));
      } else {
        const width = canvas.width || 800;
        const height = canvas.height || 600;
        const targetX = panStartRef.current.x + dx;
        const targetY = panStartRef.current.y + dy;
        setPan(clampPan(targetX, targetY, zoom, width, height));
      }
    }

    const coords = canvasToRaDec(mouseX, mouseY, canvas.width, canvas.height);
    setHoveredCoords(coords);

    // Hit-test SPHEREx 2048x2048 Detector Chunks (wrapping-aware RA delta)
    let foundChunk: SpherexDetectorChunk | null = null;
    if (showChunks) {
      for (const chunk of allChunks) {
        const raDiff = angularRaDiff(chunk.centerRa, coords.ra);
        const decDiff = Math.abs(chunk.centerDec - coords.dec);
        if (raDiff <= chunk.halfWidthRa && decDiff <= chunk.halfHeightDec) {
          foundChunk = chunk;
          break;
        }
      }
    }
    setHoveredChunk(foundChunk);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1) {
      e.preventDefault();
    }
    isDraggingRef.current = false;
  };

  // Click chunk to inspect & launch observation
  const handleClick = async () => {
    if (hasDraggedRef.current) return;

    if (hoveredChunk) {
      setSelectedChunk(hoveredChunk);
      return;
    }

    if (hoveredCoords && showChunks) {
      const chunkMatch = allChunks.find((chunk) => {
        const raDiff = angularRaDiff(chunk.centerRa, hoveredCoords.ra);
        const decDiff = Math.abs(chunk.centerDec - hoveredCoords.dec);
        return raDiff <= chunk.halfWidthRa && decDiff <= chunk.halfHeightDec;
      });

      if (chunkMatch) {
        setSelectedChunk(chunkMatch);
      }
    }
  };

  // Double click focuses directly onto footprint
  const handleDoubleClick = () => {
    if (hoveredChunk) {
      focusOnTarget(hoveredChunk.centerRa, hoveredChunk.centerDec);
      setSelectedChunk(hoveredChunk);
    }
  };

  const [launchError, setLaunchError] = useState<string | null>(null);
  const launchTargetObservation = async (ra: number, dec: number) => {
    try {
      setIsLaunching(true);
      setLaunchError(null);
      const result = await resolveCoordinates(((ra % 360) + 360) % 360, dec);
      onTargetResolved(result);
      onNavigate('Observations');
    } catch {
      setLaunchError('The position could not be opened. Retry when the backend is available.');
    } finally {
      setIsLaunching(false);
    }
  };

  const sexagesimal = hoveredCoords
    ? formatRaDec(hoveredCoords.ra, hoveredCoords.dec)
    : { raStr: '--h --m --s', decStr: '--° --\' --"' };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex-1 min-h-0 bg-[#050507] overflow-hidden select-none"
    >
      {launchError && <p role="alert" className="absolute top-14 left-4 z-40 bg-[#0B0D11] text-white p-3">{launchError}</p>}
      {/* WebGL Photographic Sky Canvas (NOIRLab 88-Constellations 4K Panorama) */}
      <canvas
        ref={glCanvasRef}
        className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-200 ${
          showPhotoSky ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Interactive 2D Vector Overlay Canvas */}
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        className={`absolute inset-0 w-full h-full block ${
          hoveredChunk
            ? 'cursor-pointer'
            : isDraggingRef.current
            ? 'cursor-grabbing'
            : 'cursor-crosshair'
        }`}
      />

      {/* Sleek Apple-style Centered Floating Toolbar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center bg-[#0B0D11]/90 backdrop-blur-md border border-[#1C2029] rounded-full px-2 py-1 shadow-2xl space-x-1.5 select-none pointer-events-auto">
        {/* Segmented Mode: 3D / Flat */}
        <div className="flex items-center bg-[#12151C] rounded-full p-0.5 border border-[#1C2029]/80">
          <button
            type="button"
            onClick={() => setProjection('sphere')}
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center space-x-1 transition-all cursor-pointer ${
              projection === 'sphere'
                ? 'bg-[#1C2029] text-white shadow-sm'
                : 'text-text-secondary hover:text-white'
            }`}
            title="3D Sphere"
          >
            <Globe size={11} />
            <span>3D</span>
          </button>
          <button
            type="button"
            onClick={() => setProjection('panoramic')}
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center space-x-1 transition-all cursor-pointer ${
              projection === 'panoramic'
                ? 'bg-[#1C2029] text-white shadow-sm'
                : 'text-text-secondary hover:text-white'
            }`}
            title="Panorama"
          >
            <Maximize2 size={11} />
            <span>Flat</span>
          </button>
        </div>

        <div className="w-px h-3.5 bg-[#1C2029]" />

        {/* Consolidated Layers Popover Trigger */}
        <div className="relative">
          <button
            ref={layersBtnRef}
            type="button"
            onClick={() => setIsLayersOpen((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center space-x-1.5 transition-colors cursor-pointer ${
              isLayersOpen
                ? 'bg-[#1C2029] text-emerald-400'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="Layers"
          >
            <Layers size={12} />
            <span>Layers</span>
            <ChevronDown size={10} className={`transition-transform duration-150 ${isLayersOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Sleek Popover Menu */}
          {isLayersOpen && (
            <div
              ref={layersMenuRef}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-48 bg-[#0B0D11]/95 backdrop-blur-md border border-[#1C2029] rounded-xl shadow-2xl p-1.5 z-50 space-y-0.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
            >
              <label className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-[#12151C] cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
                <input
                  type="checkbox"
                  checked={showChunks}
                  onChange={(e) => setShowChunks(e.target.checked)}
                  className="accent-emerald-500 rounded cursor-pointer"
                />
                <span className="flex-1 text-[11px]">Footprints</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </label>

              <label className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-[#12151C] cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
                <input
                  type="checkbox"
                  checked={showPhotoSky}
                  onChange={(e) => setShowPhotoSky(e.target.checked)}
                  className="accent-indigo-500 rounded cursor-pointer"
                />
                <span className="flex-1 text-[11px]">Photo Sky</span>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              </label>

              <label className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-[#12151C] cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
                <input
                  type="checkbox"
                  checked={showConstellations}
                  onChange={(e) => setShowConstellations(e.target.checked)}
                  className="accent-sky-500 rounded cursor-pointer"
                />
                <span className="flex-1 text-[11px]">Lines</span>
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              </label>

              <label className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-[#12151C] cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
                <input
                  type="checkbox"
                  checked={showConstellationLabels}
                  onChange={(e) => setShowConstellationLabels(e.target.checked)}
                  className="accent-slate-400 rounded cursor-pointer"
                />
                <span className="flex-1 text-[11px]">Names</span>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              </label>

              <label className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-[#12151C] cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
                <input
                  type="checkbox"
                  checked={showStars}
                  onChange={(e) => setShowStars(e.target.checked)}
                  className="accent-yellow-400 rounded cursor-pointer"
                />
                <span className="flex-1 text-[11px]">Stars</span>
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              </label>

              <label className="flex items-center space-x-2 px-2 py-1 rounded-lg hover:bg-[#12151C] cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
                <input
                  type="checkbox"
                  checked={showGraticule}
                  onChange={(e) => setShowGraticule(e.target.checked)}
                  className="accent-slate-500 rounded cursor-pointer"
                />
                <span className="flex-1 text-[11px]">Grid</span>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
              </label>
            </div>
          )}
        </div>

        <div className="w-px h-3.5 bg-[#1C2029]" />

        {/* Minimal Icon Zoom Controls */}
        <div className="flex items-center space-x-0.5">
          <button
            type="button"
            onClick={() => {
              if (projection === 'sphere') {
                setFov((f) => Math.min(75, f * 1.18));
              } else {
                setZoom((z) => {
                  const newZ = Math.max(1.0, z * 0.77);
                  const canvas = canvasRef.current;
                  if (canvas) setPan((p) => clampPan(p.x, p.y, newZ, canvas.width, canvas.height));
                  return newZ;
                });
              }
            }}
            className="p-1 text-text-secondary hover:text-white rounded-full transition-colors cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (projection === 'sphere') {
                setFov((f) => Math.max(20, f * 0.85));
              } else {
                setZoom((z) => {
                  const newZ = Math.min(25.0, z * 1.3);
                  const canvas = canvasRef.current;
                  if (canvas) setPan((p) => clampPan(p.x, p.y, newZ, canvas.width, canvas.height));
                  return newZ;
                });
              }
            }}
            className="p-1 text-text-secondary hover:text-white rounded-full transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (projection === 'sphere') {
                setYaw(180);
                setPitch(0);
                setFov(55);
              } else {
                setZoom(1.0);
                setPan({ x: 0, y: 0 });
              }
              setSelectedChunk(null);
            }}
            className="p-1 text-text-secondary hover:text-white rounded-full transition-colors cursor-pointer"
            title="Reset"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Sleek Floating Footprint Inspector Pill (Cardless) */}
      {selectedChunk && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 bg-[#0B0D11]/95 backdrop-blur-md border border-[#1C2029] rounded-xl px-3.5 py-2 shadow-2xl flex items-center space-x-3 text-xs select-none pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div className="flex flex-col">
              <span className="text-white font-medium truncate max-w-[160px] sm:max-w-[220px]">
                {selectedChunk.name}
              </span>
              <span className="text-[10px] text-text-secondary font-mono">
                {selectedChunk.id}
              </span>
            </div>
          </div>

          <div className="w-px h-5 bg-[#1C2029]" />

          {/* Quick Actions */}
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => focusOnTarget(selectedChunk.centerRa, selectedChunk.centerDec)}
              className="p-1.5 bg-[#12151C] hover:bg-[#1C2029] text-text-secondary hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Focus"
            >
              <Maximize2 size={12} />
            </button>
            <button
              type="button"
              disabled={isLaunching}
              onClick={() =>
                launchTargetObservation(
                  selectedChunk.centerRa,
                  selectedChunk.centerDec
                )
              }
              className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <ExternalLink size={11} />
              <span>{isLaunching ? 'Opening...' : 'Observe'}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedChunk(null)}
              className="p-1 text-text-tertiary hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Sleek Apple-style Centered Bottom Status & Navigation Guidance Bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center bg-[#0B0D11]/90 backdrop-blur-md border border-[#1C2029] rounded-full px-3.5 py-1.5 shadow-2xl text-[11px] text-text-secondary space-x-3 select-none pointer-events-auto">
        {/* Coordinates */}
        <div className="flex items-center space-x-1.5 font-mono tabular-nums text-text-primary text-[11px]">
          <span>{sexagesimal.raStr.slice(0, 7)}</span>
          <span className="text-text-tertiary">•</span>
          <span>{sexagesimal.decStr.slice(0, 8)}</span>
          <span className="text-text-tertiary">•</span>
          <span className="text-emerald-400 font-medium">
            {projection === 'sphere' ? `${Math.round(fov)}°` : `${zoom.toFixed(1)}×`}
          </span>
        </div>

        <div className="w-px h-3 bg-[#1C2029]" />

        {/* Survey Status */}
        <div className="flex items-center space-x-1.5 text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="font-medium">Reference sky</span>
        </div>

        <div className="hidden sm:block w-px h-3 bg-[#1C2029]" />

        {/* Short Navigation hints with icons */}
        <div className="hidden sm:flex items-center space-x-2 text-[10px] text-text-tertiary">
          <span>🖱️ Left / Middle: Pan</span>
          <span>•</span>
          <span>⇳ Scroll: Zoom</span>
          <span>•</span>
          <span>⌖ 2× Click: Focus</span>
        </div>
      </div>
    </div>
  );
};
