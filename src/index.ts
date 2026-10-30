/** Entry: defer every host registration until the plugin is ready (the planner's gotcha §18). */
import "@logseq/libs";
import "./ui.css";
import { appDeps } from "./sdk";
import { registerApp } from "./app";

logseq
  .ready(() => {
    registerApp(document.getElementById("app")!, appDeps());
  })
  .catch(console.error);
