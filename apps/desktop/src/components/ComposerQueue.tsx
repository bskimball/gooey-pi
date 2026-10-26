import { useId, useState } from "react";
import type { QueuedPrompt } from "@/types/api";
import { ArrowUp, CaretDown, Clock, PencilSimpleLine, Trash } from "./icons";

interface ComposerQueueProps {
	queuedMessages: QueuedPrompt[];
	onSendNow(message: QueuedPrompt): void;
	onEdit(message: QueuedPrompt): void;
	onDelete?(message: QueuedPrompt): void;
}

/** Messages waiting for a turn boundary, shown above the composer. Several collapse to one bar until asked for. */
export function ComposerQueue({
	queuedMessages,
	onSendNow,
	onEdit,
	onDelete,
}: ComposerQueueProps) {
	const [expanded, setExpanded] = useState(false);
	const listId = useId();
	const collapsible = queuedMessages.length > 1;
	const open = !collapsible || expanded;
	return (
		<section
			className={`composer-queue ${open ? "" : "is-collapsed"}`}
			aria-label="Queued messages"
			aria-live="polite"
		>
			{collapsible ? (
				<button
					type="button"
					className="composer-queue__header composer-queue__toggle"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					onClick={() => setExpanded((value) => !value)}
				>
					<span>
						<Clock size={13} />
						{queuedMessages.length} queued messages
					</span>
					<CaretDown size={12} className={open ? "is-open" : ""} />
				</button>
			) : (
				<div className="composer-queue__header">
					<span>
						<Clock size={13} />
						Queued message
					</span>
				</div>
			)}
			{open ? (
				<div className="composer-queue__list" id={listId}>
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
				</div>
			) : null}
		</section>
	);
}
