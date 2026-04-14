import "./style.css";
import { DiscDropGame } from "./game/DiscDropGame.js";

const app = document.querySelector("#app");
const game = new DiscDropGame(app);

await game.init();
