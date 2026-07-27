const THREAD_TYPE_LABELS: Record<string, string> = {
	youtube: "YouTube",
	imgur: "Imgur",
};

export const getThreadTypeLabel = (type: string) => THREAD_TYPE_LABELS[type] ?? type;
