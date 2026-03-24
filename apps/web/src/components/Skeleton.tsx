export function SkeletonCard() {
	return (
		<div class="hop" style={{ padding: "1rem" }}>
			<div class="skeleton" style={{ height: "0.8rem", width: "40%", marginBottom: "0.5rem" }} />
			<div class="skeleton" style={{ height: "0.7rem", width: "60%", marginBottom: "0.75rem" }} />
			<div class="skeleton" style={{ height: "3rem", width: "100%" }} />
		</div>
	);
}

export function SkeletonResults() {
	return (
		<div>
			<div class="skeleton" style={{ height: "0.85rem", width: "30%", marginBottom: "1rem" }} />
			<SkeletonCard />
			<SkeletonCard />
			<SkeletonCard />
		</div>
	);
}
