export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
}

export interface EmailSender {
	send(message: EmailMessage): Promise<void>;
}

/** Default sender until a real provider is wired up: logs instead of sending. */
export class ConsoleEmailSender implements EmailSender {
	async send(message: EmailMessage): Promise<void> {
		console.log(
			`[email:not-configured] to=${message.to} subject="${message.subject}"\n${message.text}`,
		);
	}
}

export const emailSender: EmailSender = new ConsoleEmailSender();
