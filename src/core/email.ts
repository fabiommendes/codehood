/**
 * Email module for handling email-related functionality.
 *
 * Provides an abstraction over different email providers.
 *
 * This module do not implement any concrete email provider. It defines the
 * interface and a stub implementation that simply logs the actions.
 */

/**
 * Basic representation of an e-mail.
 */
export type Email = {
	to: { name: string; email: string }[];
	subject: string;
	body: string;
	format: "md" | "plain" | "html";
};

/**
 * Interface for an email provider.
 *
 * Implementations of this interface handle the actual sending of emails.
 */
export interface EmailProvider {
	/**
	 * Queued email to be sent.
	 *
	 * @param email The email to be sent.
	 */
	sendEmail(email: Email): Promise<void>;

	/**
	 * Retrieves the list of pending emails that are queued to be sent.
	 *
	 * @returns A promise that resolves to an array of pending emails.
	 */
	pendingEmail(): Promise<Email[]>;
}

/**
 * Stub implementation of the EmailProvider interface.
 *
 * This implementation simply logs the actions instead of actually sending emails.
 */
export class StubEmailProvider implements EmailProvider {
	async sendEmail(email: Email): Promise<void> {
		console.log("Sending email:", email);
	}

	async pendingEmail(): Promise<Email[]> {
		console.log("Retrieving pending emails");
		return [];
	}
}
