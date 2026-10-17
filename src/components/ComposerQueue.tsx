import type { QueuedPrompt } from "@/types/api";
import { ArrowUp, Clock, PencilSimpleLine, Trash } from "./icons";

interface ComposerQueueProps {
	queuedMessages: QueuedPrompt[];
	harnessQueuedMessageCount: number;
	agentName?: string;
	onSendNow(message: QueuedPrompt): void;
	onEdit(message: QueuedPrompt): void;
	onDelete?(message: QueuedPrompt): void;
}

/** Messages waiting for a turn boundary, shown above the composer. */
export function ComposerQueue({
	queuedMessages,
	harnessQueuedMessageCount,
	agentName,
	onSendNow,
	onEdit,
	onDelete,
}: ComposerQueueProps) {
	return (
		<section
			className="composer-queue"
			aria-label="Queued messages"
			aria-live="polite"
		>
			<div className="composer-queue__header">
				<span>
					<Clock size={13} />
					Queued messages
				</span>
				<strong>{queuedMessages.length + harnessQueuedMessageCount}</strong>
			</div>
			<div className="composer-queue__list">
				{queuedMessages.map((queued) => (
					<div className="composer-queue__item" key={queued.id}>
						<span className="composer-queue__text">{queued.text}</span>
						<span className="composer-queue__actions">
							<button
								type="button"
								className="composer-queue__action"
								aria-label={`Send queued message immediately: ${queued.text}`}
								title="Send queued message immediately"
								onClick={() => onSendNow(queued)}
							>
								<ArrowUp size={13} />
							</button>
							<button
								type="button"
								className="composer-queue__action"
								aria-label={`Edit queued message: ${queued.text}`}
								title="Edit queued message"
								onClick={() => onEdit(queued)}
							>
								<PencilSimpleLine size={13} />
							</button>
							<button
								type="button"
								className="composer-queue__action composer-queue__action--delete"
								aria-label={`Delete queued message: ${queued.text}`}
								title="Delete queued message"
								onClick={() => onDelete?.(queued)}
							>
								<Trash size={13} />
							</button>
						</span>
					</div>
				))}
				{harnessQueuedMessageCount ? (
					<div className="composer-queue__item composer-queue__item--harness">
						<span className="composer-queue__text">
							{agentName} is holding {harnessQueuedMessageCount}{" "}
							{harnessQueuedMessageCount === 1 ? "message" : "messages"} for the
							next turn.
						</span>
					</div>
				) : null}
			</div>
		</section>
	);
}
