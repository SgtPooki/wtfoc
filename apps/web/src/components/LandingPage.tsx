/**
 * Landing page for wtfoc — informs new visitors what this is, how it
 * works, and how to sign up. Rendered at `/` for unauth visitors.
 */

import { session } from "../accounts.js";
import { navigate } from "../route.js";

export function LandingPage() {
	const authed = Boolean(session.value);
	return (
		<main class="landing">
			<header class="landing-hero">
				<h1>wtfoc</h1>
				<p class="landing-tagline">
					Decentralized, verifiable knowledge bases — stored on Filecoin, queryable anywhere.
				</p>
				<div class="landing-cta">
					{authed ? (
						<>
							<a href="/app" class="btn btn-primary">
								Open app
							</a>
							<a href="/account" class="btn">
								My account
							</a>
						</>
					) : (
						<>
							<a
								href="/login"
								class="btn btn-primary"
								onClick={(e) => {
									e.preventDefault();
									navigate("/login");
								}}
							>
								Sign up / log in
							</a>
							<a
								href="/app"
								class="btn"
								onClick={(e) => {
									e.preventDefault();
									navigate("/app");
								}}
							>
								Try a public collection
							</a>
						</>
					)}
				</div>
			</header>

			<section class="landing-how">
				<h2>What wtfoc does</h2>
				<ol>
					<li>
						<strong>Ingest.</strong> Point it at a GitHub repo, a website, a Hacker News thread.
						wtfoc chunks the text, embeds it, extracts cross-source edges (PRs fixing issues, blog
						posts citing commits).
					</li>
					<li>
						<strong>Publish.</strong> The finished collection is packaged as a CAR file and promoted
						to Filecoin. You get a CID that anyone can verify or re-query.
					</li>
					<li>
						<strong>Trace.</strong> Ask questions across the corpus. wtfoc returns answers with the
						evidence path — which sources, which chunks, which edges — so you can audit the
						reasoning.
					</li>
				</ol>
			</section>

			<section class="landing-why">
				<h2>Why care</h2>
				<ul>
					<li>
						<strong>Content-addressed.</strong> Every collection has a CID. Anyone can pull and
						verify it — no vendor lock-in.
					</li>
					<li>
						<strong>Auditable.</strong> Trace mode shows the evidence chain for every answer. No
						black-box RAG.
					</li>
					<li>
						<strong>Portable.</strong> Knowledge bases are data, not services. Hand someone a CID,
						they have the whole corpus.
					</li>
				</ul>
			</section>

			<section class="landing-next">
				<h2>Get started</h2>
				<p>
					Create an account to build your own collections, track imports, and share CIDs. Or pull an
					existing public collection by CID and start asking questions immediately.
				</p>
				<div class="landing-cta">
					{!authed && (
						<a
							href="/login"
							class="btn btn-primary"
							onClick={(e) => {
								e.preventDefault();
								navigate("/login");
							}}
						>
							Create account
						</a>
					)}
					<a href="https://github.com/sgtpooki/wtfoc" class="btn" target="_blank" rel="noreferrer">
						Source on GitHub
					</a>
				</div>
			</section>
		</main>
	);
}
