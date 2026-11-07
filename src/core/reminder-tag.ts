/**
 * Reminders ride on the user message inside this tag; UIs hide it, history keeps it. A file of its own,
 * importing nothing: the session store reads memory blocks from the reminder part and must not load the
 * agent loop to know the tag.
 */
export const REMINDER_TAG = "nhac_nho"

/** What the agent loop appends when it cuts the recalled memory section to its cap. */
export const REMINDER_CAP_MARK = "[… đã cắt bớt]"
