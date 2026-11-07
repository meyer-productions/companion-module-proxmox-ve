/** Single line version of a (possibly multi-line) display name, for dropdowns and preset names. */
export function singleLine(label: string): string {
	return label.replace(/\s*\n\s*/g, ' ')
}
