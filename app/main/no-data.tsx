import { Card } from "@/components/ui/card";

export default function NoDataBox() {
	return (
		<Card className="flex h-full w-full flex-col items-center justify-center border-zinc-200/80 py-6 shadow-none dark:border-zinc-800">
			<h3 className="text-lg">No Data</h3>
			<span className="text-gray-500">No data to display</span>
		</Card>
	);
}
