import "./style.css";
import { createApp } from "./app";

/**
 * Entry point. Everything worth testing lives in the modules this mounts;
 * this file only finds the root and reports the one failure that would
 * otherwise leave a blank page.
 */
const root = document.getElementById("app");
if (root) {
  createApp(root);
} else {
  // Not reachable with the shipped index.html, but a blank page with a
  // clean console is the worst thing to debug.
  console.error("Sheet Delta: no #app element to mount into");
}
