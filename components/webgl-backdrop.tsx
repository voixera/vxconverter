"use client";

import React, { useEffect, useRef } from "react";

export function WebglBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "low-power" });
    if (!gl) return;

    const vsSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Cinematic: noise field + radial vignette glow + scan lines + drifting particles
    const fsSource = `
      precision mediump float;
      uniform vec2 u_resolution;
      uniform float u_time;

      float hash(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        float aspect = u_resolution.x / u_resolution.y;
        vec2 st = uv;
        st.x *= aspect;

        float t = u_time * 0.08;

        // Layered fbm noise for organic atmosphere
        float n = 0.0;
        n += 0.500 * noise(st * 2.5 + vec2(t * 0.7, t * 0.5));
        n += 0.250 * noise(st * 5.0 + vec2(-t * 0.4, t * 0.9));
        n += 0.125 * noise(st * 10.0 + vec2(t * 1.1, -t * 0.6));

        // Radial spotlight from top center
        vec2 center = vec2(aspect * 0.5, 1.05);
        float dist = length(st - center);
        float spotlight = smoothstep(1.4, 0.0, dist) * 0.06;

        // Horizontal scan lines — very subtle CRT feel
        float scan = sin(uv.y * u_resolution.y * 0.5) * 0.5 + 0.5;
        float scanline = mix(1.0, 0.96, scan * 0.04);

        // Edge vignette
        vec2 vig = uv * (1.0 - uv.yx);
        float vignette = pow(vig.x * vig.y * 18.0, 0.25);

        // Subtle moving grid
        vec2 grid = fract(st * 18.0);
        float gridLine = step(0.97, grid.x) + step(0.97, grid.y);
        float gridFade = smoothstep(0.6, 0.0, dist) * 0.012;

        // Compose
        float brightness = n * spotlight * vignette * scanline;
        vec3 col = vec3(brightness * 0.9, brightness, brightness * 0.95);
        col += vec3(gridLine * gridFade);

        gl_FragColor = vec4(col, 0.55);
      }
    `;

    function createShader(glCtx: WebGLRenderingContext, type: number, source: string) {
      const shader = glCtx.createShader(type);
      if (!shader) return null;
      glCtx.shaderSource(shader, source);
      glCtx.compileShader(shader);
      if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        glCtx.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const posAttr = gl.getAttribLocation(program, "a_position");
    const resUniform = gl.getUniformLocation(program, "u_resolution");
    const timeUniform = gl.getUniformLocation(program, "u_time");

    let animationId: number;
    const startTime = performance.now();

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    window.addEventListener("resize", resize);
    resize();

    function render(now: number) {
      if (!gl || !program) return;
      gl.useProgram(program);
      gl.enableVertexAttribArray(posAttr);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resUniform, canvas!.width, canvas!.height);
      gl.uniform1f(timeUniform, (now - startTime) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationId = requestAnimationFrame(render);
    }

    animationId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 w-full h-full"
      aria-hidden="true"
    />
  );
}
