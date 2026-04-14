import "./style.css";

const app = document.querySelector("#app");

let cleanupScreen = null;
let game = null;
let viewVersion = 0;
let currentTheme = "hell";
let menuModulePromise = null;
let collectionModulePromise = null;
let gameModulePromise = null;

function loadMenuModule() {
  menuModulePromise ??= import("./screens/menu.js");
  return menuModulePromise;
}

function loadCollectionModule() {
  collectionModulePromise ??= import("./screens/collection.js");
  return collectionModulePromise;
}

function loadGameModule() {
  gameModulePromise ??= import("./game/DiscDropGame.js");
  return gameModulePromise;
}

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

function setViewMode(mode) {
  app.className = `mode-${mode} theme-${currentTheme}`;
}

function setTheme(nextTheme) {
  currentTheme = nextTheme;
}

async function showMenu() {
  const localVersion = ++viewVersion;
  clearCurrentScreen();
  setViewMode("menu");
  const { mountMenuScreen } = await loadMenuModule();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = mountMenuScreen({
    app,
    theme: currentTheme,
    onThemeChange: (nextTheme) => {
      if (nextTheme !== currentTheme) {
        setTheme(nextTheme);
        showMenu();
      }
    },
    onPlay: showPlay,
    onCollection: showCollection,
  });
}

async function showPlay() {
  const localVersion = ++viewVersion;
  clearCurrentScreen();
  setViewMode("play");
  const { DiscDropGame } = await loadGameModule();
  if (localVersion !== viewVersion) {
    return;
  }
  game = new DiscDropGame(app, { theme: currentTheme });
  await game.init();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = addBackButton(showMenu);
}

async function showCollection() {
  const localVersion = ++viewVersion;
  clearCurrentScreen();
  setViewMode("collection");
  const { mountCollectionScreen } = await loadCollectionModule();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = mountCollectionScreen({ app, onBack: showMenu });
}

showMenu();
