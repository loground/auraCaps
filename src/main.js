import "./style.css";
import { DiscDropGame } from "./game/DiscDropGame.js";
import { mountCollectionScreen } from "./screens/collection.js";
import { mountMenuScreen } from "./screens/menu.js";

const app = document.querySelector("#app");

let cleanupScreen = null;
let game = null;

function clearCurrentScreen() {
  if (cleanupScreen) {
    cleanupScreen();
    cleanupScreen = null;
  }
  if (game) {
    game.destroy();
    game = null;
  }
  app.innerHTML = "";
}

function addBackButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back-btn";
  button.textContent = "back";
  button.addEventListener("click", onClick);
  app.appendChild(button);

  return () => {
    button.removeEventListener("click", onClick);
    button.remove();
  };
}

function showMenu() {
  clearCurrentScreen();
  cleanupScreen = mountMenuScreen({
    app,
    onPlay: showPlay,
    onCollection: showCollection,
  });
}

async function showPlay() {
  clearCurrentScreen();
  game = new DiscDropGame(app);
  await game.init();
  cleanupScreen = addBackButton(showMenu);
}

function showCollection() {
  clearCurrentScreen();
  cleanupScreen = mountCollectionScreen({ app, onBack: showMenu });
}

showMenu();
