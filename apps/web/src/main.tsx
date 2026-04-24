import { render } from "preact";
import { bootAccountSession } from "./accounts.js";
import { App } from "./app";
import "./theme.css";

bootAccountSession();

const root = document.getElementById("app");
if (root) {
	render(<App />, root);
}
