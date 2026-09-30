// The Montage "looks" drawn with WebGL, recreating the ffmpeg filters the
// server applies in createMontage.js's buildClipArgs:
//   eq (brightness/contrast/gamma on luma, saturation on chroma, per-channel
//   gamma), gblur sigma=2 (Soft Glow) and unsharp 5x5 luma amount 0.5
//   (Motion accent). Steps run in the same order as the server's chain.

// Same settings as buildClipArgs, one entry per ffmpeg eq in the chain.
export function montageLook({ beautyStyle, colorBoost, contrastPolish, enhanceMotion }) {
  const steps = [];
  let blurSigma = 0;
  const eq = (o) => steps.push({ saturation: 1, contrast: 1, brightness: 0, gamma: 1, gammaRgb: 1, ...o });
  if (beautyStyle === 'cinematic') eq({ saturation: 1.12, contrast: 1.08, gammaRgb: 1.02 });
  else if (beautyStyle === 'vivid') eq({ saturation: 1.25, contrast: 1.1, brightness: 0.02 });
  else if (beautyStyle === 'glow') {
    blurSigma = 2;
    eq({ brightness: 0.05, contrast: 1.04, saturation: 1.1 });
  }
  if (colorBoost) eq({ saturation: 1.18, contrast: 1.08 });
  if (contrastPolish) eq({ contrast: 1.06, gamma: 1.02 });
  return { steps, blurSigma, sharpen: enhanceMotion ? 0.5 : 0 };
}

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Gaussian blur along one axis (run twice: horizontal, then vertical).
const BLUR = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSigma;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    sum += texture2D(uTex, vUv + uStep * float(i)) * w;
    total += w;
  }
  gl_FragColor = sum / total;
}`;

// Up to three ffmpeg-style eq steps, applied in order with clamping between
// them (each eq in ffmpeg writes 8-bit output).
const GRADE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform int uCount;
uniform vec4 uEq[3];     // saturation, contrast, brightness, gamma
uniform float uGammaRgb[3];
vec3 toYuv(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) * 0.564 + 0.5, (c.r - y) * 0.713 + 0.5);
}
vec3 toRgb(vec3 yuv) {
  float y = yuv.x; float u = yuv.y - 0.5; float v = yuv.z - 0.5;
  return vec3(y + 1.403 * v, y - 0.344 * u - 0.714 * v, y + 1.773 * u);
}
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  for (int i = 0; i < 3; i++) {
    if (i >= uCount) break;
    vec4 e = uEq[i];
    vec3 yuv = toYuv(c);
    float y = e.y * (yuv.x - 0.5) + 0.5 + e.z;
    y = y <= 0.0 ? 0.0 : pow(y, 1.0 / e.w);
    yuv.x = clamp(y, 0.0, 1.0);
    yuv.yz = clamp((yuv.yz - 0.5) * e.x + 0.5, 0.0, 1.0);
    c = clamp(toRgb(yuv), 0.0, 1.0);
    c = pow(c, vec3(1.0 / uGammaRgb[i]));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=A - sharpens brightness
// only, against a 5x5 box blur.
const SHARPEN = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uPixel;
uniform float uAmount;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float sum = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      sum += luma(texture2D(uTex, vUv + uPixel * vec2(float(x), float(y))).rgb);
    }
  }
  float y0 = luma(c);
  float y1 = y0 + uAmount * (y0 - sum / 25.0);
  gl_FragColor = vec4(clamp(c + (y1 - y0), 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`WebGL shader failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function program(gl, fragment) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`WebGL program failed: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function texture(gl, width, height) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (width) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}

function target(gl, width, height) {
  const tex = texture(gl, width, height);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

// Draws frames (canvases already fitted to width x height) with `look`
// applied onto `canvas`, which the encoder then captures.
export function createGradeRenderer(canvas, look) {
  const { width, height } = canvas;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL is not available in this browser.');

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, width, height);

  const source = texture(gl);
  const blurProgram = look.blurSigma ? program(gl, BLUR) : null;
  const gradeProgram = program(gl, GRADE);
  const sharpenProgram = look.sharpen ? program(gl, SHARPEN) : null;
  const blurA = blurProgram ? target(gl, width, height) : null;
  const blurB = blurProgram ? target(gl, width, height) : null;
  const graded = sharpenProgram ? target(gl, width, height) : null;

  const steps = look.steps.slice(0, 3);
  gl.useProgram(gradeProgram);
  gl.uniform1i(gl.getUniformLocation(gradeProgram, 'uCount'), steps.length);
  const eqValues = new Float32Array(12);
  const gammaValues = new Float32Array([1, 1, 1]);
  steps.forEach((s, i) => {
    eqValues.set([s.saturation, s.contrast, s.brightness, s.gamma], i * 4);
    gammaValues[i] = s.gammaRgb;
  });
  gl.uniform4fv(gl.getUniformLocation(gradeProgram, 'uEq'), eqValues);
  gl.uniform1fv(gl.getUniformLocation(gradeProgram, 'uGammaRgb'), gammaValues);

  const pass = (prog, inputTex, output, setUniforms) => {
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.fbo : null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    setUniforms?.();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  return {
    draw(frameCanvas) {
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frameCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      let input = source;
      if (blurProgram) {
        const sigma = () => gl.uniform1f(gl.getUniformLocation(blurProgram, 'uSigma'), look.blurSigma);
        pass(blurProgram, input, blurA, () => { sigma(); gl.uniform2f(gl.getUniformLocation(blurProgram, 'uStep'), 1 / width, 0); });
        pass(blurProgram, blurA.tex, blurB, () => { sigma(); gl.uniform2f(gl.getUniformLocation(blurProgram, 'uStep'), 0, 1 / height); });
        input = blurB.tex;
      }
      pass(gradeProgram, input, graded);
      if (sharpenProgram) {
        pass(sharpenProgram, graded.tex, null, () => {
          gl.uniform2f(gl.getUniformLocation(sharpenProgram, 'uPixel'), 1 / width, 1 / height);
          gl.uniform1f(gl.getUniformLocation(sharpenProgram, 'uAmount'), look.sharpen);
        });
      }
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
