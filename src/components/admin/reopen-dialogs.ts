/// Opens every `<dialog data-reopen>` the server rendered. A form inside a
/// dialog that failed to submit comes back with its errors, and they are
/// only seen if the dialog is open.
for (const dialog of document.querySelectorAll<HTMLDialogElement>(
	"dialog[data-reopen]",
)) {
	dialog.showModal();
}
