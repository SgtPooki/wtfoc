/**
 * /login — email magic-link sign-in via Resend (@auth/core).
 * On submit: POST /api/accounts/signin/resend with CSRF token, then show
 * "check your inbox" state. Auth.js does the actual email delivery.
 */

import { signal } from "@preact/signals";
import { signInWithEmail } from "../accounts.js";
import { navigate } from "../route.js";

const email = signal("");
const status = signal<"idle" | "sending" | "sent" | "error">("idle");
const errorMsg = signal<string | null>(null);

async function onSubmit(e: Event) {
	e.preventDefault();
	const addr = email.value.trim();
	if (!addr) return;
	status.value = "sending";
	errorMsg.value = null;
	try {
		await signInWithEmail(addr);
		status.value = "sent";
	} catch (err) {
		status.value = "error";
		errorMsg.value = err instanceof Error ? err.message : String(err);
	}
}

export function LoginPage() {
	const checkEmailParam = new URLSearchParams(window.location.search).get("check-email");
	const errorParam = new URLSearchParams(window.location.search).get("error");
	const showSent = status.value === "sent" || checkEmailParam === "1";

	return (
		<main class="auth-page">
			<a
				href="/"
				class="auth-back"
				onClick={(e) => {
					e.preventDefault();
					navigate("/");
				}}
			>
				← Back
			</a>
			<h1>Sign in to wtfoc</h1>
			{showSent ? (
				<div class="auth-info">
					<p>
						Check your inbox for <strong>{email.value || "the sign-in link"}</strong>.
					</p>
					<p class="auth-muted">
						Link expires in 24 hours. Didn't get it? Check spam, then try again.
					</p>
					<button
						type="button"
						class="btn"
						onClick={() => {
							status.value = "idle";
							email.value = "";
						}}
					>
						Use a different email
					</button>
				</div>
			) : (
				<form onSubmit={onSubmit} class="auth-form">
					<label class="auth-label">
						<span>Email</span>
						<input
							type="email"
							required
							autocomplete="email"
							value={email.value}
							onInput={(e) => {
								email.value = (e.currentTarget as HTMLInputElement).value;
							}}
							disabled={status.value === "sending"}
						/>
					</label>
					<button
						type="submit"
						class="btn btn-primary"
						disabled={status.value === "sending" || !email.value.trim()}
					>
						{status.value === "sending" ? "Sending…" : "Send magic link"}
					</button>
					{errorParam === "1" && (
						<p class="auth-error">
							Sign-in failed. The link may have expired or already been used.
						</p>
					)}
					{status.value === "error" && errorMsg.value && <p class="auth-error">{errorMsg.value}</p>}
					<p class="auth-muted">New here? Entering an email creates your account automatically.</p>
				</form>
			)}
		</main>
	);
}
