import "./style.css";
import { CubicApp } from "./app/app";

/**
 * Boot. A GPU-less environment (or a blocked WebGL context) must not leave the
 * page blank, so the failure is reported in the DOM instead.
 */
function boot(): void {
  try {
    const app = new CubicApp();
    void app;
  } catch (error) {
    const viewport = document.getElementById("viewport");
    if (viewport) {
      viewport.innerHTML = `<div class="webgl-error">
        <h2>WebGL unavailable</h2>
        <p>CUBIC needs WebGL to draw the cube. Try another browser or enable hardware acceleration.</p>
        <pre>${String(error)}</pre>
      </div>`;
    }
    console.error(error);
  }
}

boot();
