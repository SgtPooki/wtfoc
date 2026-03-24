import { render } from "preact";
import { App } from "./app";
import "./theme.css";

const root = document.getElementById("app");
if (root) {
	render(<App />, root);
}
