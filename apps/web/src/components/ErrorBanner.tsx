interface ErrorBannerProps {
	message: string;
	onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
	return (
		<div class="error-banner">
			<span>{message}</span>
			{onDismiss && (
				<button type="button" class="error-dismiss" onClick={onDismiss}>
					Dismiss
				</button>
			)}
		</div>
	);
}
